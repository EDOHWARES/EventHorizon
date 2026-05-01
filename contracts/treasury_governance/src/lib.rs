#![no_std]
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, token, Address, Env, Symbol, Vec};

// ── Data Structures ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Active   = 0,
    Passed   = 1,
    Rejected = 2,
    Executed = 3,
    Expired  = 4,
}

/// A governance-voted spending proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SpendProposal {
    pub id: u64,
    pub proposer: Address,
    pub asset: Address,       // Token to spend
    pub recipient: Address,   // Where funds go
    pub amount: i128,
    pub description: Symbol,
    pub votes_for: i128,
    pub votes_against: i128,
    pub end_ledger: u32,      // Voting deadline (ledger sequence)
    pub status: ProposalStatus,
}

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    GovToken,         // Governance token address (vote weight = balance)
    Quorum,           // Minimum votes_for required (i128)
    VotingPeriod,     // Duration in ledgers (u32)
    ProposalCount,
    Proposal(u64),
    Voted(u64, Address), // bool – has address voted on proposal?
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct Deposited {
    pub asset: Address,
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ProposalCreated {
    pub id: u64,
    pub proposer: Address,
    pub asset: Address,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: bool,
    pub weight: i128,
}

#[contractevent]
pub struct ProposalFinalized {
    pub id: u64,
    pub status: ProposalStatus,
    pub votes_for: i128,
    pub votes_against: i128,
}

#[contractevent]
pub struct SpendExecuted {
    pub proposal_id: u64,
    pub asset: Address,
    pub recipient: Address,
    pub amount: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TreasuryGovernance;

#[contractimpl]
impl TreasuryGovernance {
    // ── Initialization ────────────────────────────────────────────────────────

    /// One-time setup.
    /// - `gov_token`: token whose balance determines voting weight.
    /// - `quorum`: minimum `votes_for` (in token units) for a proposal to pass.
    /// - `voting_period`: number of ledgers a proposal stays open.
    pub fn initialize(
        env: Env,
        admin: Address,
        gov_token: Address,
        quorum: i128,
        voting_period: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if quorum <= 0 { panic!("Quorum must be positive"); }
        if voting_period == 0 { panic!("Voting period must be > 0"); }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GovToken, &gov_token);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage().instance().set(&DataKey::VotingPeriod, &voting_period);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
    }

    // ── Treasury Deposit ──────────────────────────────────────────────────────

    /// Deposit any Soroban token into the treasury.
    pub fn deposit(env: Env, from: Address, asset: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 { panic!("Amount must be positive"); }

        token::Client::new(&env, &asset).transfer(&from, &env.current_contract_address(), &amount);

        env.events().publish_event(&Deposited { asset, from, amount });
    }

    // ── Governance ────────────────────────────────────────────────────────────

    /// Propose a spend from the treasury. Any governance token holder may propose.
    pub fn propose(
        env: Env,
        proposer: Address,
        asset: Address,
        recipient: Address,
        amount: i128,
        description: Symbol,
    ) -> u64 {
        proposer.require_auth();
        if amount <= 0 { panic!("Amount must be positive"); }

        // Proposer must hold at least 1 unit of the governance token.
        let gov_token: Address = env.storage().instance().get(&DataKey::GovToken).unwrap();
        let weight = token::Client::new(&env, &gov_token).balance(&proposer);
        if weight <= 0 { panic!("No governance token balance"); }

        let voting_period: u32 = env.storage().instance().get(&DataKey::VotingPeriod).unwrap();
        let end_ledger = env.ledger().sequence() + voting_period;

        let id: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let proposal = SpendProposal {
            id,
            proposer: proposer.clone(),
            asset: asset.clone(),
            recipient: recipient.clone(),
            amount,
            description,
            votes_for: 0,
            votes_against: 0,
            end_ledger,
            status: ProposalStatus::Active,
        };

        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &(id + 1));

        env.events().publish_event(&ProposalCreated { id, proposer, asset, recipient, amount });

        id
    }

    /// Cast a vote on an active proposal. Weight = governance token balance.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        let voted_key = DataKey::Voted(proposal_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            panic!("Already voted");
        }

        let mut proposal: SpendProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Active {
            panic!("Proposal not active");
        }
        if env.ledger().sequence() > proposal.end_ledger {
            panic!("Voting period ended");
        }

        let gov_token: Address = env.storage().instance().get(&DataKey::GovToken).unwrap();
        let weight = token::Client::new(&env, &gov_token).balance(&voter);
        if weight <= 0 { panic!("No governance token balance"); }

        if support {
            proposal.votes_for += weight;
        } else {
            proposal.votes_against += weight;
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&voted_key, &true);

        env.events().publish_event(&VoteCast { proposal_id, voter, support, weight });
    }

    /// Finalize a proposal after its voting period ends.
    /// Sets status to Passed or Rejected based on quorum and majority.
    pub fn finalize(env: Env, proposal_id: u64) {
        let mut proposal: SpendProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Active {
            panic!("Proposal already finalized");
        }
        if env.ledger().sequence() <= proposal.end_ledger {
            panic!("Voting period not ended");
        }

        let quorum: i128 = env.storage().instance().get(&DataKey::Quorum).unwrap();

        proposal.status = if proposal.votes_for >= quorum && proposal.votes_for > proposal.votes_against {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Rejected
        };

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish_event(&ProposalFinalized {
            id: proposal_id,
            status: proposal.status,
            votes_for: proposal.votes_for,
            votes_against: proposal.votes_against,
        });
    }

    /// Execute a passed proposal: transfer tokens from treasury to recipient.
    pub fn execute(env: Env, proposal_id: u64) {
        let mut proposal: SpendProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Passed {
            panic!("Proposal not passed");
        }

        token::Client::new(&env, &proposal.asset).transfer(
            &env.current_contract_address(),
            &proposal.recipient,
            &proposal.amount,
        );

        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish_event(&SpendExecuted {
            proposal_id,
            asset: proposal.asset,
            recipient: proposal.recipient,
            amount: proposal.amount,
        });
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_proposal(env: Env, proposal_id: u64) -> SpendProposal {
        env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found")
    }

    pub fn has_voted(env: Env, proposal_id: u64, voter: Address) -> bool {
        env.storage().persistent().has(&DataKey::Voted(proposal_id, voter))
    }

    pub fn treasury_balance(env: Env, asset: Address) -> i128 {
        token::Client::new(&env, &asset).balance(&env.current_contract_address())
    }

    pub fn proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0)
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Admin can expire a proposal that has passed its end_ledger without being finalized.
    pub fn expire(env: Env, proposal_id: u64) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut proposal: SpendProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Active {
            panic!("Proposal not active");
        }

        proposal.status = ProposalStatus::Expired;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish_event(&ProposalFinalized {
            id: proposal_id,
            status: ProposalStatus::Expired,
            votes_for: proposal.votes_for,
            votes_against: proposal.votes_against,
        });
    }

    /// Returns all active proposal IDs (up to `limit`).
    pub fn list_proposals(env: Env, limit: u64) -> Vec<u64> {
        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let mut ids = Vec::new(&env);
        let start = if count > limit { count - limit } else { 0 };
        for i in start..count {
            ids.push_back(i);
        }
        ids
    }
}

mod test;
