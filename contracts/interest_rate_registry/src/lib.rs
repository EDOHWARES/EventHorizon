#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, log, symbol_short, vec, Env, Map, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateData {
    pub pool_id: Symbol,
    pub utilization: u32, // percentage 0-100
    pub interest_rate: u32, // basis points
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Rates,
}

#[contract]
pub struct InterestRateRegistry;

#[contractimpl]
impl InterestRateRegistry {
    /// Initialize the contract
    pub fn init(env: Env) {
        env.storage().instance().set(&DataKey::Rates, &Map::<Symbol, RateData>::new(&env));
    }

    /// Update interest rate for a pool
    pub fn update_rate(env: Env, pool_id: Symbol, utilization: u32, interest_rate: u32) {
        if utilization > 100 {
            panic!("Utilization must be <= 100");
        }
        let mut rates: Map<Symbol, RateData> = env.storage().instance().get(&DataKey::Rates).unwrap_or(Map::new(&env));
        
        let rate_data = RateData {
            pool_id: pool_id.clone(),
            utilization,
            interest_rate,
            last_updated: env.ledger().timestamp(),
        };
        
        rates.set(pool_id.clone(), rate_data);
        env.storage().instance().set(&DataKey::Rates, &rates);
        
        // Emit telemetry event
        env.events().publish((symbol_short!("rate"), symbol_short!("updated")), (pool_id.clone(), utilization, interest_rate));
        
        // Warning for rapid spike
        if interest_rate > 5000 { // arbitrary threshold, e.g. 50%
            env.events().publish((symbol_short!("rate"), symbol_short!("spike")), (pool_id, interest_rate));
        }
    }

    /// Get rate data for a pool
    pub fn get_rate(env: Env, pool_id: Symbol) -> Option<RateData> {
        let rates: Map<Symbol, RateData> = env.storage().instance().get(&DataKey::Rates).unwrap_or(Map::new(&env));
        rates.get(pool_id)
    }

    /// Get all rates
    pub fn get_all_rates(env: Env) -> Vec<RateData> {
        let rates: Map<Symbol, RateData> = env.storage().instance().get(&DataKey::Rates).unwrap_or(Map::new(&env));
        let mut result = vec![&env];
        for (_, rate) in rates.iter() {
            result.push_back(rate);
        }
        result
    }
}

mod test;