#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol};

/// Per-node uptime tracking and reward state.
#[contracttype]
#[derive(Clone)]
pub struct NodeInfo {
    /// Total polling windows the node was expected to participate in.
    pub windows_expected: u64,
    /// Windows the node actually reported in (on-time).
    pub windows_reported: u64,
    /// Accumulated rewards not yet claimed.
    pub pending_rewards: i128,
    /// Ledger timestamp of last report.
    pub last_report_ts: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    RewardToken,
    /// Reward tokens paid per window reported (scaled by SCALAR).
    RewardPerWindow,
    /// Penalty deducted per missed window (scaled by SCALAR).
    PenaltyPerWindow,
    Node(Address),
}

const SCALAR: i128 = 1_000_000;

#[contract]
pub struct RewardPoolContract;

#[contractimpl]
impl RewardPoolContract {
    /// Initialize the contract. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        reward_token: Address,
        reward_per_window: i128,
        penalty_per_window: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if reward_per_window <= 0 {
            panic!("reward_per_window must be positive");
        }
        if penalty_per_window < 0 {
            panic!("penalty_per_window must be non-negative");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::RewardPerWindow, &reward_per_window);
        env.storage().instance().set(&DataKey::PenaltyPerWindow, &penalty_per_window);
    }

    /// Called by a node operator to record participation in a polling window.
    /// `windows_reported` is the count of windows completed since last call.
    /// `windows_expected` is the total windows that elapsed since last call.
    pub fn report(env: Env, node: Address, windows_reported: u64, windows_expected: u64) {
        node.require_auth();

        if windows_expected == 0 {
            panic!("windows_expected must be > 0");
        }
        if windows_reported > windows_expected {
            panic!("windows_reported cannot exceed windows_expected");
        }

        let reward_per_window: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerWindow)
            .expect("Not initialized");
        let penalty_per_window: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PenaltyPerWindow)
            .unwrap_or(0);

        let mut info = env
            .storage()
            .persistent()
            .get::<DataKey, NodeInfo>(&DataKey::Node(node.clone()))
            .unwrap_or(NodeInfo {
                windows_expected: 0,
                windows_reported: 0,
                pending_rewards: 0,
                last_report_ts: env.ledger().timestamp(),
            });

        // Earned rewards for reported windows
        let earned = (windows_reported as i128)
            .checked_mul(reward_per_window)
            .expect("overflow")
            .checked_div(SCALAR)
            .expect("div zero");

        // Penalty for missed windows
        let missed = windows_expected - windows_reported;
        let penalty = (missed as i128)
            .checked_mul(penalty_per_window)
            .expect("overflow")
            .checked_div(SCALAR)
            .expect("div zero");

        let delta = earned.saturating_sub(penalty);
        info.pending_rewards = info.pending_rewards.saturating_add(delta);
        info.windows_expected += windows_expected;
        info.windows_reported += windows_reported;
        info.last_report_ts = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Node(node.clone()), &info);

        env.events().publish(
            (Symbol::new(&env, "report"), node),
            (windows_reported, windows_expected, delta),
        );
    }

    /// Node operator claims all pending rewards.
    pub fn claim(env: Env, node: Address) -> i128 {
        node.require_auth();

        let mut info: NodeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Node(node.clone()))
            .expect("Node not found");

        let amount = info.pending_rewards;
        if amount <= 0 {
            panic!("No rewards to claim");
        }

        info.pending_rewards = 0;
        env.storage()
            .persistent()
            .set(&DataKey::Node(node.clone()), &info);

        let reward_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::RewardToken)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &reward_token);
        token_client.transfer(&env.current_contract_address(), &node, &amount);

        env.events()
            .publish((Symbol::new(&env, "claim"), node), amount);

        amount
    }

    /// Admin deposits reward tokens into the pool.
    pub fn fund(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let reward_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::RewardToken)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &reward_token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        env.events()
            .publish((Symbol::new(&env, "fund"), from), amount);
    }

    /// Returns node info for a given operator.
    pub fn get_node_info(env: Env, node: Address) -> NodeInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Node(node))
            .expect("Node not found")
    }

    /// Returns the uptime ratio scaled by SCALAR (e.g. 950_000 = 95%).
    pub fn get_uptime_ratio(env: Env, node: Address) -> i128 {
        let info: NodeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Node(node))
            .expect("Node not found");

        if info.windows_expected == 0 {
            return 0;
        }

        (info.windows_reported as i128)
            .checked_mul(SCALAR)
            .expect("overflow")
            .checked_div(info.windows_expected as i128)
            .expect("div zero")
    }
}

mod test;
