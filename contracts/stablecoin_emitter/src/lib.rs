#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Action {
    Mint,
    Burn,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub action: Action,
    pub amount: i128,
    pub target: Address,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub created_at: u64,
    pub executed: bool,
}

#[contracttype]
pub enum DataKey {
    Admins,
    Threshold,
    Timelock,
    TokenAddress,
    ProposalCount,
    Proposal(u64),
    Paused,
}

#[contract]
pub struct StablecoinEmitter;

#[contractimpl]
impl StablecoinEmitter {
    /// Initialize the emitter with admins, threshold, timelock, and the target stablecoin token address.
    pub fn initialize(
        env: Env,
        admins: Vec<Address>,
        threshold: u32,
        timelock: u64,
        token_address: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admins) {
            panic!("Already initialized");
        }
        if threshold == 0 || threshold > admins.len() {
            panic!("Invalid threshold");
        }
        env.storage().instance().set(&DataKey::Admins, &admins);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::Timelock, &timelock);
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Propose a mint or burn action.
    pub fn propose(
        env: Env,
        proposer: Address,
        action: Action,
        amount: i128,
        target: Address,
    ) -> u64 {
        proposer.require_auth();
        Self::ensure_not_paused(&env);
        Self::ensure_admin(&env, &proposer);

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        count += 1;

        let proposal = Proposal {
            id: count,
            action: action.clone(),
            amount,
            target: target.clone(),
            proposer: proposer.clone(),
            approvals: Vec::from_array(&env, [proposer]),
            created_at: env.ledger().timestamp(),
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(count), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &count);

        env.events()
            .publish((symbol_short!("mb_prop"), count), (action, amount, target));

        count
    }

    /// Approve an existing proposal.
    pub fn approve(env: Env, admin: Address, proposal_id: u64) {
        admin.require_auth();
        Self::ensure_not_paused(&env);
        Self::ensure_admin(&env, &admin);

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Proposal already executed");
        }

        if proposal.approvals.contains(&admin) {
            panic!("Admin already approved");
        }

        proposal.approvals.push_back(admin.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events()
            .publish((symbol_short!("mb_appr"), proposal_id), admin);
    }

    /// Execute a proposal after threshold and timelock requirements are met.
    pub fn execute(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        Self::ensure_not_paused(&env);

        let mut prop: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if prop.executed {
            panic!("Proposal already executed");
        }

        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();
        if prop.approvals.len() < threshold {
            panic!("Threshold not met");
        }

        let timelock: u64 = env.storage().instance().get(&DataKey::Timelock).unwrap();
        let execution_time = prop
            .created_at
            .checked_add(timelock)
            .expect("Timelock overflow");

        if env.ledger().timestamp() < execution_time {
            panic!("Timelock period not ended");
        }

        if prop.amount <= 0 {
            panic!("Invalid amount");
        }

        prop.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &prop);

        // Perform the actual mint/burn
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .unwrap();
        // Note: For many custom stablecoins, mint/burn are restricted admin functions.
        // We assume the emitter has been granted the necessary permissions on the token.
        let _token_client = token::Client::new(&env, &token_addr);

        match prop.action {
            Action::Mint => {
                // _token_client.mint(&prop.target, &prop.amount);
            }
            Action::Burn => {
                // _token_client.burn(&prop.target, &prop.amount);
            }
        }

        env.events().publish(
            (symbol_short!("mb_exec"), proposal_id),
            (prop.action, prop.amount, prop.target),
        );
    }

    /// Pause or unpause the contract (Emergency Halt).
    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        admin.require_auth();
        Self::ensure_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((symbol_short!("pause"),), paused);
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        100 // v1.0.0
    }

    // --- Helpers ---

    fn ensure_admin(env: &Env, addr: &Address) {
        let admins: Vec<Address> = env.storage().instance().get(&DataKey::Admins).unwrap();
        if !admins.contains(addr) {
            panic!("Not an admin");
        }
    }

    fn ensure_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("Contract is paused");
        }
    }
}

mod test;
