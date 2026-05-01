#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token,
    Address, Env, String, Vec,
};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,                  // Address – security committee / admin
    VotingToken,            // Address – governance token used for vote weight
    Quorum,                 // i128 – minimum FOR votes required to pass
    VotingPeriod,           // u64 – default voting period in seconds
    ProposalCount,          // u64
    Proposal(u64),          // WhitelistProposal
    Voted(u64, Address),    // bool – has address voted on proposal?
    Whitelist(Address),     // WhitelistEntry – whitelisted contract info
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Action carried by a governance proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    /// Add a contract to the high-priority whitelist.
    Add(String),   // label / description
    /// Remove a contract from the whitelist.
    Remove,
}

/// A governance proposal to add or remove a contract from the whitelist.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WhitelistProposal {
    pub id: u64,
    pub proposer: Address,
    /// The contract address being proposed for addition or removal.
    pub target: Address,
    pub action: ProposalAction,
    pub votes_for: i128,
    pub votes_against: i128,
    /// Unix timestamp after which voting is closed.
    pub end_time: u64,
    pub executed: bool,
}

/// Metadata stored for each whitelisted contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WhitelistEntry {
    /// Human-readable label / description.
    pub label: String,
    /// Address that proposed the addition.
    pub added_by: Address,
    /// Ledger timestamp when the entry was added.
    pub added_at: u64,
    /// Priority tier (higher = polled more frequently by EventHorizon workers).
    pub priority: u32,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct DaoWhitelist;

#[contractimpl]
impl DaoWhitelist {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// One-time setup.
    /// `voting_token` is the governance token whose balance determines vote weight.
    /// `quorum` is the minimum FOR-vote weight required for a proposal to pass.
    /// `voting_period` is the default duration (seconds) for new proposals.
    pub fn initialize(
        env: Env,
        admin: Address,
        voting_token: Address,
        quorum: i128,
        voting_period: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if quorum <= 0 {
            panic!("Quorum must be positive");
        }
        if voting_period == 0 {
            panic!("Voting period must be positive");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VotingToken, &voting_token);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage().instance().set(&DataKey::VotingPeriod, &voting_period);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
    }

    // ── Governance ────────────────────────────────────────────────────────────

    /// Any token holder can propose adding or removing a contract.
    /// Returns the new proposal ID.
    pub fn propose(
        env: Env,
        proposer: Address,
        target: Address,
        action: ProposalAction,
    ) -> u64 {
        proposer.require_auth();

        // Proposer must hold at least 1 token unit.
        let token_addr: Address = env.storage().instance().get(&DataKey::VotingToken).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        if token_client.balance(&proposer) <= 0 {
            panic!("No voting power");
        }

        let voting_period: u64 = env.storage().instance().get(&DataKey::VotingPeriod).unwrap();
        let end_time = env.ledger().timestamp() + voting_period;

        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let proposal_id = count + 1;
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);

        let is_removal = action == ProposalAction::Remove;
        let proposal = WhitelistProposal {
            id: proposal_id,
            proposer: proposer.clone(),
            target: target.clone(),
            action,
            votes_for: 0,
            votes_against: 0,
            end_time,
            executed: false,
        };
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("prop_new"), proposal_id),
            (proposer, target, is_removal),
        );

        proposal_id
    }

    /// Cast a vote on an open proposal.
    /// Vote weight equals the voter's current token balance.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        let mut proposal: WhitelistProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if env.ledger().timestamp() > proposal.end_time {
            panic!("Voting period ended");
        }
        if proposal.executed {
            panic!("Proposal already executed");
        }

        let voted_key = DataKey::Voted(proposal_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            panic!("Already voted");
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::VotingToken).unwrap();
        let voting_power = token::Client::new(&env, &token_addr).balance(&voter);
        if voting_power <= 0 {
            panic!("No voting power");
        }

        if support {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_against += voting_power;
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&voted_key, &true);

        env.events().publish(
            (symbol_short!("voted"), proposal_id),
            (voter, support, voting_power),
        );
    }

    /// Execute a successful proposal after the voting period ends.
    /// Panics if quorum is not met or FOR votes don't exceed AGAINST votes.
    pub fn execute(env: Env, proposal_id: u64) {
        let mut proposal: WhitelistProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Already executed");
        }
        if env.ledger().timestamp() <= proposal.end_time {
            panic!("Voting period not ended");
        }

        let quorum: i128 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        if proposal.votes_for <= proposal.votes_against || proposal.votes_for < quorum {
            panic!("Proposal failed");
        }

        proposal.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        match &proposal.action {
            ProposalAction::Remove => {
                env.storage().persistent().remove(&DataKey::Whitelist(proposal.target.clone()));
                env.events().publish(
                    (symbol_short!("wl_rem"), proposal.target.clone()),
                    proposal_id,
                );
            }
            ProposalAction::Add(label) => {
                let entry = WhitelistEntry {
                    label: label.clone(),
                    added_by: proposal.proposer.clone(),
                    added_at: env.ledger().timestamp(),
                    priority: 1u32,
                };
                env.storage().persistent().set(&DataKey::Whitelist(proposal.target.clone()), &entry);
                env.events().publish(
                    (symbol_short!("wl_add"), proposal.target.clone()),
                    (proposal_id, label.clone()),
                );
            }
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Admin can set the priority tier of a whitelisted contract.
    pub fn set_priority(env: Env, admin: Address, target: Address, priority: u32) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized");
        }
        let mut entry: WhitelistEntry = env.storage().persistent()
            .get(&DataKey::Whitelist(target.clone()))
            .expect("Contract not whitelisted");
        entry.priority = priority;
        env.storage().persistent().set(&DataKey::Whitelist(target.clone()), &entry);

        env.events().publish(
            (symbol_short!("priority"), target),
            priority,
        );
    }

    /// Emergency removal by admin (bypasses governance).
    pub fn emergency_remove(env: Env, admin: Address, target: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized");
        }
        env.storage().persistent().remove(&DataKey::Whitelist(target.clone()));
        env.events().publish(
            (symbol_short!("emrg_rem"), target),
            (),
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn is_whitelisted(env: Env, target: Address) -> bool {
        env.storage().persistent().has(&DataKey::Whitelist(target))
    }

    pub fn get_entry(env: Env, target: Address) -> WhitelistEntry {
        env.storage().persistent()
            .get(&DataKey::Whitelist(target))
            .expect("Contract not whitelisted")
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> WhitelistProposal {
        env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found")
    }

    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0)
    }
}

mod test;
