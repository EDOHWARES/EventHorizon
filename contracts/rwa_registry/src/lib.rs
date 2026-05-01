#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, Env, String, Vec,
};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,                      // Address – contract admin
    Signers,                    // Vec<Address> – multi-sig signers
    Threshold,                  // u32 – required approvals
    NextDocId,                  // u64 – monotonic document counter
    NextProposalId,             // u64 – monotonic proposal counter
    Doc(u64),                   // DocRecord
    DocHash(Bytes),             // u64 – reverse lookup: hash → doc_id
    Approval(u64, Address),     // bool – has signer approved this proposal?
    Proposal(u64),              // UpdateProposal
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Immutable document record anchored on-chain.
/// The `hash` field is written once and never overwritten.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DocRecord {
    /// SHA-256 (or any fixed-length) hash of the off-chain document.
    pub hash: Bytes,
    /// Human-readable label / IPFS CID / external URI.
    pub label: String,
    /// Address that originally anchored this document.
    pub owner: Address,
    /// Ledger timestamp at anchor time (immutable).
    pub anchored_at: u64,
    /// Mutable metadata – updated only via multi-sig approval.
    pub metadata: String,
    /// Verification status – set by admin or multi-sig.
    pub verified: bool,
}

/// A pending multi-sig proposal to update mutable fields of a document.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpdateProposal {
    pub doc_id: u64,
    pub new_metadata: String,
    pub new_verified: bool,
    pub approvals: u32,
    pub executed: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct RwaRegistry;

#[contractimpl]
impl RwaRegistry {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// One-time setup.
    /// `signers` form the multi-sig committee; `threshold` is the minimum
    /// number of approvals required to execute a metadata-update proposal.
    pub fn initialize(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
        threshold: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("Invalid threshold");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::NextDocId, &0u64);
        env.storage().instance().set(&DataKey::NextProposalId, &0u64);
    }

    // ── Document anchoring ────────────────────────────────────────────────────

    /// Anchor a new document hash on-chain. The hash is immutable once stored.
    /// Panics if the same hash has already been anchored.
    /// Returns the assigned document ID.
    pub fn anchor(
        env: Env,
        owner: Address,
        hash: Bytes,
        label: String,
        metadata: String,
    ) -> u64 {
        owner.require_auth();

        if hash.len() == 0 {
            panic!("Hash cannot be empty");
        }
        if env.storage().persistent().has(&DataKey::DocHash(hash.clone())) {
            panic!("Hash already anchored");
        }

        let doc_id = Self::_next_doc_id(&env);
        let record = DocRecord {
            hash: hash.clone(),
            label,
            owner,
            anchored_at: env.ledger().timestamp(),
            metadata,
            verified: false,
        };

        env.storage().persistent().set(&DataKey::Doc(doc_id), &record);
        env.storage().persistent().set(&DataKey::DocHash(hash.clone()), &doc_id);

        env.events().publish(
            (symbol_short!("anchored"), doc_id),
            hash,
        );

        doc_id
    }

    // ── Multi-sig metadata update ─────────────────────────────────────────────

    /// Any signer can propose a metadata update for an existing document.
    /// Returns the assigned proposal ID.
    pub fn propose_update(
        env: Env,
        proposer: Address,
        doc_id: u64,
        new_metadata: String,
        new_verified: bool,
    ) -> u64 {
        proposer.require_auth();
        Self::_require_signer(&env, &proposer);
        // Ensure document exists.
        if !env.storage().persistent().has(&DataKey::Doc(doc_id)) {
            panic!("Document not found");
        }

        let proposal_id = Self::_next_proposal_id(&env);
        let proposal = UpdateProposal {
            doc_id,
            new_metadata,
            new_verified,
            approvals: 0,
            executed: false,
        };
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("prop_new"), proposal_id),
            (doc_id, proposer),
        );

        proposal_id
    }

    /// A signer approves a pending update proposal.
    /// Executes automatically once the threshold is reached.
    pub fn approve_update(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();
        Self::_require_signer(&env, &signer);

        let mut proposal: UpdateProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Proposal already executed");
        }

        let approval_key = DataKey::Approval(proposal_id, signer.clone());
        if env.storage().temporary().has(&approval_key) {
            panic!("Already approved");
        }
        env.storage().temporary().set(&approval_key, &true);

        proposal.approvals += 1;
        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();

        env.events().publish(
            (symbol_short!("approved"), proposal_id),
            (signer, proposal.approvals),
        );

        if proposal.approvals >= threshold {
            // Execute: update the document's mutable fields.
            let mut doc: DocRecord = env.storage().persistent()
                .get(&DataKey::Doc(proposal.doc_id))
                .unwrap();
            doc.metadata = proposal.new_metadata.clone();
            doc.verified = proposal.new_verified;
            env.storage().persistent().set(&DataKey::Doc(proposal.doc_id), &doc);

            proposal.executed = true;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

            env.events().publish(
                (symbol_short!("updated"), proposal.doc_id),
                (proposal.new_metadata, proposal.new_verified),
            );
        } else {
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Admin can directly set the verification status of a document.
    pub fn admin_verify(env: Env, admin: Address, doc_id: u64, verified: bool) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized");
        }
        let mut doc: DocRecord = env.storage().persistent()
            .get(&DataKey::Doc(doc_id))
            .expect("Document not found");
        doc.verified = verified;
        env.storage().persistent().set(&DataKey::Doc(doc_id), &doc);

        env.events().publish(
            (symbol_short!("verified"), doc_id),
            verified,
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_doc(env: Env, doc_id: u64) -> DocRecord {
        env.storage().persistent()
            .get(&DataKey::Doc(doc_id))
            .expect("Document not found")
    }

    pub fn get_doc_by_hash(env: Env, hash: Bytes) -> DocRecord {
        let doc_id: u64 = env.storage().persistent()
            .get(&DataKey::DocHash(hash))
            .expect("Hash not found");
        env.storage().persistent()
            .get(&DataKey::Doc(doc_id))
            .unwrap()
    }

    pub fn is_anchored(env: Env, hash: Bytes) -> bool {
        env.storage().persistent().has(&DataKey::DocHash(hash))
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> UpdateProposal {
        env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found")
    }

    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Signers).unwrap()
    }

    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap()
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn _next_doc_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextDocId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextDocId, &(id + 1));
        id
    }

    fn _next_proposal_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextProposalId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextProposalId, &(id + 1));
        id
    }

    fn _require_signer(env: &Env, addr: &Address) {
        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).unwrap();
        if !signers.contains(addr) {
            panic!("Not a signer");
        }
    }
}

mod test;
