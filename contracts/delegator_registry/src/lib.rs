#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol, symbol_short};

// ── Data Structures ───────────────────────────────────────────────────────────

/// Per-validator totals for efficient dashboard indexing.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ValidatorInfo {
    pub validator: Address,
    pub total_delegated: i128,
    pub delegator_count: u32,
    pub active: bool,
}

/// Per-delegator position for a specific validator.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationPosition {
    pub delegator: Address,
    pub validator: Address,
    pub amount: i128,
    pub reward_debt: i128, // Tracks already-claimed rewards (reward-per-token model)
    pub since_ts: u64,
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    StakingToken,
    ValidatorCount,
    Validator(Address),
    // Delegation(delegator, validator) -> DelegationPosition
    Delegation(Address, Address),
    // Accumulated reward per token for a validator (scaled 1e12)
    RewardPerToken(Address),
    // Total rewards distributed to a validator (for slashing reference)
    TotalRewards(Address),
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct DelegatorRegistry;

#[contractimpl]
impl DelegatorRegistry {
    // ── Initialization ────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, staking_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakingToken, &staking_token);
        env.storage().instance().set(&DataKey::ValidatorCount, &0u32);
    }

    // ── Validator Management ──────────────────────────────────────────────

    /// Register a new validator. Admin only.
    pub fn register_validator(env: Env, validator: Address) {
        Self::_require_admin(&env);

        if env.storage().persistent().has(&DataKey::Validator(validator.clone())) {
            panic!("Validator already registered");
        }

        let info = ValidatorInfo {
            validator: validator.clone(),
            total_delegated: 0,
            delegator_count: 0,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Validator(validator.clone()), &info);
        env.storage().persistent().set(&DataKey::RewardPerToken(validator.clone()), &0i128);
        env.storage().persistent().set(&DataKey::TotalRewards(validator.clone()), &0i128);

        let count: u32 = env.storage().instance().get(&DataKey::ValidatorCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::ValidatorCount, &(count + 1));

        env.events().publish(
            (Symbol::new(&env, "validator_registered"), validator),
            env.ledger().timestamp(),
        );
    }

    // ── Delegation ────────────────────────────────────────────────────────

    /// Delegate tokens to a validator. Transfers tokens from delegator to contract.
    #[allow(deprecated)]
    pub fn delegate(env: Env, delegator: Address, validator: Address, amount: i128) {
        delegator.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let mut vinfo: ValidatorInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Validator(validator.clone()))
            .expect("Validator not found");

        if !vinfo.active {
            panic!("Validator is not active");
        }

        // Settle pending rewards before updating position
        let reward_per_token: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RewardPerToken(validator.clone()))
            .unwrap_or(0);

        let key = DataKey::Delegation(delegator.clone(), validator.clone());
        let mut pos: DelegationPosition = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(DelegationPosition {
                delegator: delegator.clone(),
                validator: validator.clone(),
                amount: 0,
                reward_debt: 0,
                since_ts: env.ledger().timestamp(),
            });

        // Claim any pending rewards before adding to position
        if pos.amount > 0 {
            let pending = Self::_pending_rewards(&pos, reward_per_token);
            if pending > 0 {
                Self::_distribute_reward(&env, &delegator, pending);
                env.events().publish(
                    (Symbol::new(&env, "reward_accrued"), delegator.clone()),
                    (validator.clone(), pending),
                );
            }
        }

        // Transfer tokens
        let token_addr: Address = env.storage().instance().get(&DataKey::StakingToken).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &delegator,
            &env.current_contract_address(),
            &amount,
        );

        // Update position
        let is_new = pos.amount == 0;
        pos.amount += amount;
        pos.reward_debt = (pos.amount * reward_per_token) / 1_000_000_000_000i128;
        pos.since_ts = env.ledger().timestamp();
        env.storage().persistent().set(&key, &pos);

        // Update validator totals
        vinfo.total_delegated += amount;
        if is_new {
            vinfo.delegator_count += 1;
        }
        env.storage().persistent().set(&DataKey::Validator(validator.clone()), &vinfo);

        env.events().publish(
            (Symbol::new(&env, "delegated"), delegator.clone()),
            (validator, amount, pos.amount),
        );
    }

    /// Undelegate tokens from a validator. Claims pending rewards first.
    #[allow(deprecated)]
    pub fn undelegate(env: Env, delegator: Address, validator: Address, amount: i128) {
        delegator.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let key = DataKey::Delegation(delegator.clone(), validator.clone());
        let mut pos: DelegationPosition = env
            .storage()
            .persistent()
            .get(&key)
            .expect("No delegation found");

        if pos.amount < amount {
            panic!("Insufficient delegation");
        }

        let reward_per_token: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RewardPerToken(validator.clone()))
            .unwrap_or(0);

        // Claim pending rewards
        let pending = Self::_pending_rewards(&pos, reward_per_token);
        if pending > 0 {
            Self::_distribute_reward(&env, &delegator, pending);
            env.events().publish(
                (Symbol::new(&env, "reward_accrued"), delegator.clone()),
                (validator.clone(), pending),
            );
        }

        // Return tokens
        let token_addr: Address = env.storage().instance().get(&DataKey::StakingToken).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &delegator,
            &amount,
        );

        // Update position
        pos.amount -= amount;
        pos.reward_debt = (pos.amount * reward_per_token) / 1_000_000_000_000i128;

        let mut vinfo: ValidatorInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Validator(validator.clone()))
            .unwrap();
        vinfo.total_delegated -= amount;
        if pos.amount == 0 {
            vinfo.delegator_count -= 1;
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &pos);
        }
        env.storage().persistent().set(&DataKey::Validator(validator.clone()), &vinfo);

        env.events().publish(
            (Symbol::new(&env, "undelegated"), delegator),
            (validator, amount),
        );
    }

    // ── Reward Distribution ───────────────────────────────────────────────

    /// Admin distributes rewards to a validator's delegators (reward-per-token model).
    /// This is O(1) regardless of delegator count — high-efficiency storage.
    pub fn distribute_rewards(env: Env, validator: Address, reward_amount: i128) {
        Self::_require_admin(&env);
        if reward_amount <= 0 {
            panic!("Reward must be positive");
        }

        let vinfo: ValidatorInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Validator(validator.clone()))
            .expect("Validator not found");

        if vinfo.total_delegated == 0 {
            panic!("No delegators");
        }

        // reward_per_token_increase = reward_amount * 1e12 / total_delegated
        let increase = (reward_amount * 1_000_000_000_000i128) / vinfo.total_delegated;
        let current: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RewardPerToken(validator.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::RewardPerToken(validator.clone()), &(current + increase));

        let total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalRewards(validator.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::TotalRewards(validator.clone()), &(total + reward_amount));

        env.events().publish(
            (Symbol::new(&env, "rewards_distributed"), validator),
            (reward_amount, increase),
        );
    }

    /// Slash a validator — reduces total_delegated and emits a slashing event.
    pub fn slash_validator(env: Env, validator: Address, slash_amount: i128) {
        Self::_require_admin(&env);

        let mut vinfo: ValidatorInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Validator(validator.clone()))
            .expect("Validator not found");

        if slash_amount > vinfo.total_delegated {
            panic!("Slash exceeds total delegated");
        }

        vinfo.total_delegated -= slash_amount;
        env.storage().persistent().set(&DataKey::Validator(validator.clone()), &vinfo);

        env.events().publish(
            (symbol_short!("slashed"), validator),
            slash_amount,
        );
    }

    /// Claim pending rewards for a delegator without undelegating.
    pub fn claim_rewards(env: Env, delegator: Address, validator: Address) -> i128 {
        delegator.require_auth();

        let key = DataKey::Delegation(delegator.clone(), validator.clone());
        let mut pos: DelegationPosition = env
            .storage()
            .persistent()
            .get(&key)
            .expect("No delegation found");

        let reward_per_token: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RewardPerToken(validator.clone()))
            .unwrap_or(0);

        let pending = Self::_pending_rewards(&pos, reward_per_token);
        if pending > 0 {
            Self::_distribute_reward(&env, &delegator, pending);
            pos.reward_debt = (pos.amount * reward_per_token) / 1_000_000_000_000i128;
            env.storage().persistent().set(&key, &pos);

            env.events().publish(
                (Symbol::new(&env, "reward_accrued"), delegator),
                (validator, pending),
            );
        }

        pending
    }

    // ── View Functions ────────────────────────────────────────────────────

    pub fn get_validator(env: Env, validator: Address) -> ValidatorInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Validator(validator))
            .expect("Validator not found")
    }

    pub fn get_delegation(env: Env, delegator: Address, validator: Address) -> DelegationPosition {
        env.storage()
            .persistent()
            .get(&DataKey::Delegation(delegator, validator))
            .expect("Delegation not found")
    }

    pub fn get_pending_rewards(env: Env, delegator: Address, validator: Address) -> i128 {
        let key = DataKey::Delegation(delegator.clone(), validator.clone());
        if !env.storage().persistent().has(&key) {
            return 0;
        }
        let pos: DelegationPosition = env.storage().persistent().get(&key).unwrap();
        let rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RewardPerToken(validator))
            .unwrap_or(0);
        Self::_pending_rewards(&pos, rpt)
    }

    // ── Internal Helpers ──────────────────────────────────────────────────

    fn _pending_rewards(pos: &DelegationPosition, reward_per_token: i128) -> i128 {
        if pos.amount == 0 {
            return 0;
        }
        let accrued = (pos.amount * reward_per_token) / 1_000_000_000_000i128;
        if accrued > pos.reward_debt {
            accrued - pos.reward_debt
        } else {
            0
        }
    }

    #[allow(deprecated)]
    fn _distribute_reward(env: &Env, to: &Address, amount: i128) {
        let token_addr: Address = env.storage().instance().get(&DataKey::StakingToken).unwrap();
        token::Client::new(env, &token_addr).transfer(
            &env.current_contract_address(),
            to,
            &amount,
        );
    }

    fn _require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();
    }
}

mod test;
