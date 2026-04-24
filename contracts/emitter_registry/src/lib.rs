#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol, String,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetadata {
    pub name: Symbol,
    pub description: String,
    pub verified: bool,
    pub added_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub enum ProposalAction {
    Add(ContractMetadata),
    Remove,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub target_contract: Address,
    pub action: ProposalAction,
    pub votes_for: i128,
    pub votes_against: i128,
    pub end_time: u64,
    pub executed: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,           // Security Committee
    VotingToken,     // Token used for voting power
    Quorum,          // Minimum votes for required to pass
    ProposalCount,   // Total proposals created
    Proposal(u64),   // Individual proposal data
    Voted(u64, Address), // Tracks if an address has voted on a proposal
    Registry(Address), // Whitelisted contracts and their metadata
}

#[contract]
pub struct EmitterRegistry;

#[contractimpl]
impl EmitterRegistry {
    /// Initialize the registry with the security committee (admin) and voting parameters.
    pub fn initialize(env: Env, admin: Address, voting_token: Address, quorum: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VotingToken, &voting_token);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
    }

    /// Propose adding or removing a contract from the registry.
    pub fn propose(
        env: Env,
        proposer: Address,
        target_contract: Address,
        action: ProposalAction,
        voting_period: u64,
    ) -> u64 {
        proposer.require_auth();

        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let proposal_id = count + 1;

        let end_time = env.ledger().timestamp() + voting_period;

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            target_contract,
            action: action.clone(),
            votes_for: 0,
            votes_against: 0,
            end_time,
            executed: false,
        };

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);

        let is_removal = match action {
            ProposalAction::Remove => true,
            ProposalAction::Add(_) => false,
        };

        env.events().publish(
            (symbol_short!("prop_new"), proposal_id),
            (proposer, is_removal),
        );

        proposal_id
    }

    /// Cast a vote on a proposal using the balance of the voting token as weight.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if env.ledger().timestamp() > proposal.end_time {
            panic!("Voting period has ended");
        }

        let voted_key = DataKey::Voted(proposal_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            panic!("Already voted");
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::VotingToken).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let voting_power = token_client.balance(&voter);

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
            (symbol_short!("vote"), proposal_id, voter),
            (support, voting_power),
        );
    }

    /// Execute a successful proposal to update the whitelist.
    pub fn execute(env: Env, proposal_id: u64) {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Already executed");
        }

        if env.ledger().timestamp() <= proposal.end_time {
            panic!("Voting period not yet ended");
        }

        let quorum: i128 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        if proposal.votes_for <= proposal.votes_against || proposal.votes_for < quorum {
            panic!("Proposal failed or quorum not met");
        }

        proposal.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        match proposal.action {
            ProposalAction::Remove => {
                env.storage().persistent().remove(&DataKey::Registry(proposal.target_contract.clone()));
                Self::emit_whitelist_update(&env, proposal.target_contract, false, None);
            }
            ProposalAction::Add(metadata) => {
                env.storage().persistent().set(&DataKey::Registry(proposal.target_contract.clone()), &metadata);
                Self::emit_whitelist_update(&env, proposal.target_contract, true, Some(metadata));
            }
        }
    }

    /// Emergency removal of a contract by the security committee.
    pub fn emergency_remove(env: Env, admin: Address, target_contract: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized: Only security committee can perform emergency removal");
        }

        env.storage().persistent().remove(&DataKey::Registry(target_contract.clone()));
        Self::emit_whitelist_update(&env, target_contract, false, None);
    }

    /// Check if a contract is whitelisted.
    pub fn is_verified(env: Env, target_contract: Address) -> bool {
        env.storage().persistent().has(&DataKey::Registry(target_contract))
    }

    /// Get metadata for a whitelisted contract.
    pub fn get_metadata(env: Env, target_contract: Address) -> Option<ContractMetadata> {
        env.storage().persistent().get(&DataKey::Registry(target_contract))
    }

    fn emit_whitelist_update(env: &Env, contract: Address, verified: bool, metadata: Option<ContractMetadata>) {
        env.events().publish(
            (symbol_short!("wl_upd"), contract),
            (verified, metadata),
        );
    }
}

mod test;
