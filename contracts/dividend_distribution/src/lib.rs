#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, log, token, Address, Env, Symbol, Vec, Map};
use soroban_sdk::testutils::Address as _;

#[contracttype]
#[derive(Clone, Debug)]
pub struct EpochInfo {
    pub epoch_id: u64,
    pub start_ts: u64,
    pub end_ts: u64,
    pub total_staked: i128,
    pub total_dividends: i128,
    pub distributed: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DividendInfo {
    pub user: Address,
    pub staked_amount: i128,
    pub dividend_amount: i128,
    pub epoch_id: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    StakingContract,
    DividendToken,
    EpochDuration, // seconds
    CurrentEpoch,
    Epoch(u64), // epoch_id -> EpochInfo
    Dividends(u64), // epoch_id -> Vec<DividendInfo>
    DividendPool, // total dividends available for distribution
    StakedSnapshot(u64), // epoch_id -> Map<Address, i128> of staked amounts at epoch start
}

const SCALAR: i128 = 1_000_000;

#[contract]
pub struct DividendDistributionContract;

#[contractimpl]
impl DividendDistributionContract {
    /// Initializes the dividend distribution contract.
    pub fn initialize(
        env: Env,
        admin: Address,
        staking_contract: Address,
        dividend_token: Address,
        epoch_duration: u64,
        initial_dividend_pool: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakingContract, &staking_contract);
        env.storage().instance().set(&DataKey::DividendToken, &dividend_token);
        env.storage().instance().set(&DataKey::EpochDuration, &epoch_duration);
        env.storage().instance().set(&DataKey::CurrentEpoch, &0u64);
        env.storage().instance().set(&DataKey::DividendPool, &initial_dividend_pool);

        // Transfer initial dividend pool to contract
        let token_client = token::Client::new(&env, &dividend_token);
        token_client.transfer(&admin, &env.current_contract_address(), &initial_dividend_pool);

        log!(&env, "Dividend Distribution Contract initialized");
    }

    /// Starts a new epoch for dividend distribution.
    pub fn start_new_epoch(env: Env, admin: Address) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        if admin != current_admin {
            panic!("Unauthorized");
        }

        let current_epoch: u64 = env.storage().instance().get(&DataKey::CurrentEpoch).unwrap_or(0);
        let new_epoch_id = current_epoch + 1;
        let now = env.ledger().timestamp();
        let epoch_duration: u64 = env.storage().instance().get(&DataKey::EpochDuration).unwrap_or(86400); // default 1 day
        let end_ts = now + epoch_duration;

        // Snapshot current staked positions
        let (total_staked, stakers_snapshot) = Self::snapshot_staked_positions(&env);

        let epoch_info = EpochInfo {
            epoch_id: new_epoch_id,
            start_ts: now,
            end_ts,
            total_staked,
            total_dividends: 0,
            distributed: false,
        };

        env.storage().instance().set(&DataKey::CurrentEpoch, &new_epoch_id);
        env.storage().persistent().set(&DataKey::Epoch(new_epoch_id), &epoch_info);
        env.storage().persistent().set(&DataKey::StakedSnapshot(new_epoch_id), &stakers_snapshot);

        env.events().publish(
            (Symbol::new(&env, "new_epoch"), new_epoch_id),
            (now, end_ts, total_staked)
        );

        log!(&env, "New epoch started", new_epoch_id);
    }

    /// Calculates dividends for the current epoch based on staking positions.
    /// This should be called at the end of each epoch.
    pub fn calculate_dividends(env: Env, epoch_id: u64) -> Vec<DividendInfo> {
        let epoch_info: EpochInfo = env.storage().persistent()
            .get(&DataKey::Epoch(epoch_id))
            .expect("Epoch not found");

        if epoch_info.distributed {
            panic!("Dividends already distributed for this epoch");
        }

        let total_staked = epoch_info.total_staked;
        if total_staked <= 0 {
            return Vec::new(&env);
        }

        let dividend_pool: i128 = env.storage().instance().get(&DataKey::DividendPool).unwrap_or(0);
        if dividend_pool <= 0 {
            return Vec::new(&env);
        }

        // Get staked snapshot for this epoch
        let stakers_snapshot: Map<Address, i128> = env.storage().persistent()
            .get(&DataKey::StakedSnapshot(epoch_id))
            .unwrap_or(Map::new(&env));

        let mut dividends = Vec::new(&env);
        let mut total_distributed = 0i128;

        for (staker, staked_amount) in stakers_snapshot.iter() {
            if staked_amount > 0 {
                let dividend = (dividend_pool * staked_amount) / total_staked;
                let dividend_info = DividendInfo {
                    user: staker.clone(),
                    staked_amount,
                    dividend_amount: dividend,
                    epoch_id,
                };
                dividends.push_back(dividend_info);
                total_distributed += dividend;
            }
        }

        // Update epoch info
        let mut updated_epoch = epoch_info.clone();
        updated_epoch.total_dividends = total_distributed;
        env.storage().persistent().set(&DataKey::Epoch(epoch_id), &updated_epoch);

        // Store dividends
        env.storage().persistent().set(&DataKey::Dividends(epoch_id), &dividends);

        dividends
    }

    /// Distributes calculated dividends for an epoch.
    pub fn distribute_dividends(env: Env, epoch_id: u64) {
        let mut epoch_info: EpochInfo = env.storage().persistent()
            .get(&DataKey::Epoch(epoch_id))
            .expect("Epoch not found");

        if epoch_info.distributed {
            panic!("Already distributed");
        }

        let dividends: Vec<DividendInfo> = env.storage().persistent()
            .get(&DataKey::Dividends(epoch_id))
            .expect("Dividends not calculated");

        let dividend_token_addr: Address = env.storage().instance().get(&DataKey::DividendToken).expect("Not init");
        let token_client = token::Client::new(&env, &dividend_token_addr);

        for dividend in dividends.iter() {
            token_client.transfer(&env.current_contract_address(), &dividend.user, &dividend.dividend_amount);
            env.events().publish(
                (Symbol::new(&env, "dividend_distributed"), dividend.user.clone(), epoch_id),
                dividend.dividend_amount
            );
        }

        epoch_info.distributed = true;
        env.storage().persistent().set(&DataKey::Epoch(epoch_id), &epoch_info);

        let dividend_pool: i128 = env.storage().instance().get(&DataKey::DividendPool).unwrap_or(0);
        env.storage().instance().set(&DataKey::DividendPool, &(dividend_pool - epoch_info.total_dividends));

        env.events().publish(
            (Symbol::new(&env, "epoch_distribution_complete"), epoch_id),
            epoch_info.total_dividends
        );
    }

    /// Processes the current epoch if it has ended: calculates and distributes dividends.
    /// Can be called by admin or automated systems.
    pub fn process_epoch(env: Env, admin: Address) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        if admin != current_admin {
            panic!("Unauthorized");
        }

        let current_epoch: u64 = env.storage().instance().get(&DataKey::CurrentEpoch).unwrap_or(0);
        if current_epoch == 0 {
            return; // No epoch started
        }

        let epoch_info: EpochInfo = env.storage().persistent()
            .get(&DataKey::Epoch(current_epoch))
            .expect("Epoch not found");

        if epoch_info.distributed || env.ledger().timestamp() < epoch_info.end_ts {
            return; // Not yet ended or already distributed
        }

        // Calculate dividends
        let _ = Self::calculate_dividends(env.clone(), current_epoch);

        // Distribute dividends
        Self::distribute_dividends(env, current_epoch);
    }

    /// Returns the distribution report for an epoch.
    pub fn get_epoch_report(env: Env, epoch_id: u64) -> (EpochInfo, Vec<DividendInfo>) {
        let epoch_info: EpochInfo = env.storage().persistent()
            .get(&DataKey::Epoch(epoch_id))
            .expect("Epoch not found");

        let dividends: Vec<DividendInfo> = env.storage().persistent()
            .get(&DataKey::Dividends(epoch_id))
            .unwrap_or(Vec::new(&env));

        (epoch_info, dividends)
    }

    // --- Helper Functions ---

    fn snapshot_staked_positions(env: &Env) -> (i128, Map<Address, i128>) {
        // In reality, call staking contract to get total staked and list of stakers with amounts
        // For this implementation, mock data
        let total_staked = 1000000000i128; // 1000 tokens
        let mut snapshot = Map::new(env);
        let user1 = Address::generate(env);
        let user2 = Address::generate(env);
        snapshot.set(user1, 500000000i128); // 500 tokens
        snapshot.set(user2, 500000000i128); // 500 tokens
        (total_staked, snapshot)
    }
}