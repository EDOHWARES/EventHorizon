#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, log, symbol_short, vec, Address, Env, Map, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PollerData {
    pub address: Address,
    pub reputation: u32, // 0-100
    pub uptime: u32, // percentage
    pub last_report: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Pollers,
}

#[contract]
pub struct PollerReputationQueue;

#[contractimpl]
impl PollerReputationQueue {
    /// Initialize the contract
    pub fn init(env: Env) {
        env.storage().instance().set(&DataKey::Pollers, &Map::<Address, PollerData>::new(&env));
    }

    /// Register a poller
    pub fn register_poller(env: Env, poller: Address) {
        let mut pollers: Map<Address, PollerData> = env.storage().instance().get(&DataKey::Pollers).unwrap_or(Map::new(&env));
        
        let poller_data = PollerData {
            address: poller.clone(),
            reputation: 50, // start neutral
            uptime: 100,
            last_report: env.ledger().timestamp(),
        };
        
        pollers.set(poller, poller_data);
        env.storage().instance().set(&DataKey::Pollers, &pollers);
    }

    /// Update poller performance
    pub fn update_performance(env: Env, poller: Address, uptime: u32, on_time: bool) {
        let mut pollers: Map<Address, PollerData> = env.storage().instance().get(&DataKey::Pollers).unwrap_or(Map::new(&env));
        
        if let Some(mut poller_data) = pollers.get(poller.clone()) {
            poller_data.uptime = uptime;
            poller_data.last_report = env.ledger().timestamp();
            
            if on_time {
                poller_data.reputation = (poller_data.reputation + 1).min(100);
            } else {
                poller_data.reputation = poller_data.reputation.saturating_sub(5);
                // Slash event
                env.events().publish((symbol_short!("poller"), symbol_short!("slashed")), (poller.clone(), poller_data.reputation));
            }
            
            pollers.set(poller, poller_data);
            env.storage().instance().set(&DataKey::Pollers, &pollers);
        }
    }

    /// Get poller data
    pub fn get_poller(env: Env, poller: Address) -> Option<PollerData> {
        let pollers: Map<Address, PollerData> = env.storage().instance().get(&DataKey::Pollers).unwrap_or(Map::new(&env));
        pollers.get(poller)
    }

    /// Get priority queue (sorted by reputation)
    pub fn get_priority_queue(env: Env) -> Vec<PollerData> {
        let pollers: Map<Address, PollerData> = env.storage().instance().get(&DataKey::Pollers).unwrap_or(Map::new(&env));
        let mut result = vec![&env];
        for (_, poller) in pollers.iter() {
            result.push_back(poller);
        }
        // Sort by reputation descending (simple bubble sort for demo)
        for i in 0..result.len() {
            for j in 0..result.len() - i - 1 {
                if result.get(j).unwrap().reputation < result.get(j + 1).unwrap().reputation {
                    let temp = result.get(j).unwrap();
                    result.set(j, result.get(j + 1).unwrap());
                    result.set(j + 1, temp);
                }
            }
        }
        result
    }
}

mod test;