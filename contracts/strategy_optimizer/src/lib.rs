#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype,
    Address, Env, Map, Symbol,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Strategies,      // Map<Address, u32> - Strategy address to APY (basis points)
    CurrentStrategy, // Address
    Threshold,       // u32 - Threshold in basis points (e.g. 100 = 1%)
    Paused,          // bool
}

#[contractevent]
pub struct StrategyAdded {
    pub strategy: Address,
    pub apy: u32,
}

#[contractevent]
pub struct APYUpdated {
    pub strategy: Address,
    pub old_apy: u32,
    pub new_apy: u32,
}

#[contractevent]
pub struct RebalanceNeeded {
    pub current_strategy: Address,
    pub current_apy: u32,
    pub suggested_strategy: Address,
    pub suggested_apy: u32,
    pub spread: u32,
}

#[contract]
pub struct StrategyOptimizer;

#[contractimpl]
impl StrategyOptimizer {
    pub fn initialize(env: Env, admin: Address, threshold: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Strategies, &Map::<Address, u32>::new(&env));
    }

    pub fn add_strategy(env: Env, strategy: Address, apy: u32) {
        Self::_require_admin(&env);
        let mut strategies: Map<Address, u32> = env.storage().instance().get(&DataKey::Strategies).unwrap();
        strategies.set(strategy.clone(), apy);
        env.storage().instance().set(&DataKey::Strategies, &strategies);

        if !env.storage().instance().has(&DataKey::CurrentStrategy) {
            env.storage().instance().set(&DataKey::CurrentStrategy, &strategy);
        }

        env.events().publish_event(&StrategyAdded { strategy, apy });
    }

    pub fn update_apy(env: Env, strategy: Address, new_apy: u32) {
        Self::_require_admin(&env);
        Self::_require_not_paused(&env);

        let mut strategies: Map<Address, u32> = env.storage().instance().get(&DataKey::Strategies).unwrap();
        let old_apy = strategies.get(strategy.clone()).expect("Strategy not found");
        strategies.set(strategy.clone(), new_apy);
        env.storage().instance().set(&DataKey::Strategies, &strategies);

        env.events().publish_event(&APYUpdated { strategy: strategy.clone(), old_apy, new_apy });

        // Check if rebalance is needed
        Self::_check_rebalance(&env);
    }

    pub fn set_current_strategy(env: Env, strategy: Address) {
        Self::_require_admin(&env);
        let strategies: Map<Address, u32> = env.storage().instance().get(&DataKey::Strategies).unwrap();
        if !strategies.contains_key(strategy.clone()) {
            panic!("Strategy not in registry");
        }
        env.storage().instance().set(&DataKey::CurrentStrategy, &strategy);
    }

    pub fn set_threshold(env: Env, threshold: u32) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn get_strategies(env: Env) -> Map<Address, u32> {
        env.storage().instance().get(&DataKey::Strategies).unwrap()
    }

    pub fn get_current_strategy(env: Env) -> Address {
        env.storage().instance().get(&DataKey::CurrentStrategy).expect("No current strategy")
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn _check_rebalance(env: &Env) {
        let current_strategy: Address = env.storage().instance().get(&DataKey::CurrentStrategy).expect("No current strategy");
        let strategies: Map<Address, u32> = env.storage().instance().get(&DataKey::Strategies).unwrap();
        let current_apy = strategies.get(current_strategy.clone()).unwrap();
        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();

        let mut best_strategy = current_strategy.clone();
        let mut max_apy = current_apy;

        for (strategy, apy) in strategies.iter() {
            if apy > max_apy {
                max_apy = apy;
                best_strategy = strategy;
            }
        }

        if max_apy > current_apy && (max_apy - current_apy) >= threshold {
            env.events().publish_event(&RebalanceNeeded {
                current_strategy,
                current_apy,
                suggested_strategy: best_strategy,
                suggested_apy: max_apy,
                spread: max_apy - current_apy,
            });
        }
    }

    fn _require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
    }

    fn _require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused { panic!("Contract is paused"); }
    }
}

mod test;
