#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, log, token, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug)]
pub struct StakeInfo {
    pub amount: i128,
    pub start_ts: u64,
    pub last_claim_ts: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    StakingToken,
    RewardToken,
    RewardRate,     // Rewards per token per second (scaled)
    LockUpPeriod,   // Seconds tokens must be locked to avoid penalty
    PenaltyRate,    // Max penalty in bps (e.g., 5000 for 50%)
    TotalStaked,
    Stake(Address),
    EmergencyMode,
}

const SCALAR: i128 = 1_000_000; // Used to scale reward rates for more precision

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    /// Initializes the staking contract parameters.
    pub fn initialize(
        env: Env,
        admin: Address,
        staking_token: Address,
        reward_token: Address,
        reward_rate: i128,
        lock_up_period: u64,
        penalty_rate: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if penalty_rate < 0 || penalty_rate > 10000 {
            panic!("Penalty rate must be between 0 and 10000");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakingToken, &staking_token);
        env.storage().instance().set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::RewardRate, &reward_rate);
        env.storage().instance().set(&DataKey::LockUpPeriod, &lock_up_period);
        env.storage().instance().set(&DataKey::PenaltyRate, &penalty_rate);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage().instance().set(&DataKey::EmergencyMode, &false);
    }

    /// Admin toggles emergency mode to allow bypassing penalties
    pub fn set_emergency_mode(env: Env, admin: Address, enabled: bool) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin { panic!("Not admin"); }
        env.storage().instance().set(&DataKey::EmergencyMode, &enabled);
    }

    /// Deposits tokens into the staking pool.
    #[allow(deprecated)]
    pub fn stake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("Must stake more than zero"); }

        let staking_token_addr: Address = env.storage().instance().get(&DataKey::StakingToken).expect("Not init");
        let token_client = token::Client::new(&env, &staking_token_addr);

        // Calculate pending rewards before updating stake
        let now = env.ledger().timestamp();
        let mut stake_info = env.storage().persistent()
            .get::<DataKey, StakeInfo>(&DataKey::Stake(user.clone()))
            .unwrap_or(StakeInfo { amount: 0, start_ts: now, last_claim_ts: now });

        if stake_info.amount > 0 {
            // Internal claim logic: automatically claim rewards before restaking
            // This simplifies the math and ensures rewards are calculated correctly
            let rewards = Self::calculate_rewards(&env, &stake_info, now);
            if rewards > 0 {
                Self::distribute_rewards(&env, &user, rewards);
            }
        }

        // Transfer tokens from user to contract
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        // Update stake info
        stake_info.amount += amount;
        stake_info.start_ts = now; // Reset start time for lock-up period on fresh stake?
        // Actually, resetting start time for the entire balance is common for simplicity,
        // or we could track multiple stakes. We'll stick to a simple single-position model.
        stake_info.last_claim_ts = now;

        env.storage().persistent().set(&DataKey::Stake(user.clone()), &stake_info);
        
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total + amount));

        env.events().publish(
            (Symbol::new(&env, "Staked"), user),
            amount
        );
    }

    /// Withdraws all staked tokens, applying penalties if early.
    #[allow(deprecated)]
    pub fn unstake(env: Env, user: Address) -> i128 {
        user.require_auth();
        
        let stake_info: StakeInfo = env.storage().persistent()
            .get(&DataKey::Stake(user.clone()))
            .expect("No stake found");

        if stake_info.amount <= 0 { panic!("Zero balance"); }

        let now = env.ledger().timestamp();
        
        // 1. Claim final rewards
        let rewards = Self::calculate_rewards(&env, &stake_info, now);
        if rewards > 0 {
            Self::distribute_rewards(&env, &user, rewards);
        }

        // 2. Check for early withdrawal penalty
        let lock_period: u64 = env.storage().instance().get(&DataKey::LockUpPeriod).unwrap_or(0);
        let emergency_mode: bool = env.storage().instance().get(&DataKey::EmergencyMode).unwrap_or(false);
        let mut final_amount = stake_info.amount;
        
        if now < stake_info.start_ts + lock_period && !emergency_mode {
            let penalty_rate_bps: i128 = env.storage().instance().get(&DataKey::PenaltyRate).unwrap_or(0);
            let elapsed = now - stake_info.start_ts;
            let penalty = Self::calculate_exponential_penalty(stake_info.amount, penalty_rate_bps, elapsed, lock_period);
            final_amount -= penalty;
            
            if penalty > 0 {
                log!(&env, "Penalty applied for early unstaking", penalty);
                env.events().publish((Symbol::new(&env, "PenaltyApplied"), user.clone()), penalty);
            }
        }

        // 3. Transfer remaining principal back
        let staking_token_addr: Address = env.storage().instance().get(&DataKey::StakingToken).expect("Not init");
        let token_client = token::Client::new(&env, &staking_token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &final_amount);

        // 4. Update state
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total - stake_info.amount));
        env.storage().persistent().remove(&DataKey::Stake(user.clone()));

        env.events().publish(
            (Symbol::new(&env, "Unstaked"), user),
            final_amount
        );

        final_amount
    }

    /// Emergency withdrawal: withdraws staked tokens without claiming rewards. Bypasses penalty.
    #[allow(deprecated)]
    pub fn emergency_withdraw(env: Env, user: Address) -> i128 {
        user.require_auth();
        
        let stake_info: StakeInfo = env.storage().persistent()
            .get(&DataKey::Stake(user.clone()))
            .expect("No stake found");

        if stake_info.amount <= 0 { panic!("Zero balance"); }

        // Bypassing rewards calculation entirely.
        // Also bypassing penalty for emergency exit.
        
        let final_amount = stake_info.amount;

        let staking_token_addr: Address = env.storage().instance().get(&DataKey::StakingToken).expect("Not init");
        let token_client = token::Client::new(&env, &staking_token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &final_amount);

        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total - stake_info.amount));
        env.storage().persistent().remove(&DataKey::Stake(user.clone()));

        env.events().publish(
            (Symbol::new(&env, "Unstaked"), user),
            final_amount
        );

        final_amount
    }

    /// Claims accumulated rewards without unstaking.
    pub fn claim_rewards(env: Env, user: Address) -> i128 {
        user.require_auth();

        let mut stake_info: StakeInfo = env.storage().persistent()
            .get(&DataKey::Stake(user.clone()))
            .expect("No stake found");

        let now = env.ledger().timestamp();
        let rewards = Self::calculate_rewards(&env, &stake_info, now);
        
        if rewards > 0 {
            Self::distribute_rewards(&env, &user, rewards);
            stake_info.last_claim_ts = now;
            env.storage().persistent().set(&DataKey::Stake(user), &stake_info);
        }

        rewards
    }

    /// Returns the current pending rewards for a user.
    pub fn get_pending_rewards(env: Env, user: Address) -> i128 {
        let stake_info: StakeInfo = env.storage().persistent()
            .get(&DataKey::Stake(user))
            .unwrap_or(StakeInfo { amount: 0, start_ts: 0, last_claim_ts: 0 });
        
        Self::calculate_rewards(&env, &stake_info, env.ledger().timestamp())
    }

    /// Returns stake information for a user.
    pub fn get_stake_info(env: Env, user: Address) -> StakeInfo {
        env.storage().persistent()
            .get(&DataKey::Stake(user))
            .expect("No stake found")
    }

    // --- Helper Functions ---

    fn calculate_exponential_penalty(amount: i128, max_penalty_bps: i128, elapsed: u64, lock_up_period: u64) -> i128 {
        if elapsed >= lock_up_period {
            return 0;
        }

        let half_life = lock_up_period / 5;
        if half_life == 0 {
            return 0;
        }

        let half_lives = elapsed / half_life;
        let remainder = elapsed % half_life;

        let mut current_penalty = (amount * max_penalty_bps) / 10000;

        for _ in 0..half_lives {
            current_penalty /= 2;
        }

        let decay_for_remainder = (current_penalty / 2) * (remainder as i128) / (half_life as i128);
        current_penalty -= decay_for_remainder;

        current_penalty
    }

    fn calculate_rewards(env: &Env, stake: &StakeInfo, now: u64) -> i128 {
        if stake.amount <= 0 || now <= stake.last_claim_ts {
            return 0;
        }

        let rate: i128 = env.storage().instance().get(&DataKey::RewardRate).unwrap_or(0);
        let elapsed = now - stake.last_claim_ts;

        // Reward = Amount * Rate * Time / SCALAR
        stake.amount
            .checked_mul(rate)
            .expect("Overflow")
            .checked_mul(elapsed as i128)
            .expect("Overflow")
            .checked_div(SCALAR)
            .expect("Division by zero")
    }

    #[allow(deprecated)]
    fn distribute_rewards(env: &Env, to: &Address, amount: i128) {
        let reward_token_addr: Address = env.storage().instance().get(&DataKey::RewardToken).expect("Not init");
        let token_client = token::Client::new(env, &reward_token_addr);
        
        token_client.transfer(&env.current_contract_address(), to, &amount);

        env.events().publish(
            (Symbol::new(env, "reward_payout"), to.clone()),
            amount
        );
    }
}

mod test;
