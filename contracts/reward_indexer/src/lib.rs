#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, log, symbol_short, vec, Env, Map, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardData {
    pub pool_id: Symbol,
    pub amount: i128,
    pub multiplier: u32,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Rewards,
}

#[contract]
pub struct RewardIndexer;

#[contractimpl]
impl RewardIndexer {
    /// Initialize the contract
    pub fn init(env: Env) {
        // Initialize storage
        env.storage().instance().set(&DataKey::Rewards, &Map::<Symbol, RewardData>::new(&env));
    }

    /// Add or update reward for a pool
    pub fn add_reward(env: Env, pool_id: Symbol, amount: i128, multiplier: u32) {
        let mut rewards: Map<Symbol, RewardData> = env.storage().instance().get(&DataKey::Rewards).unwrap_or(Map::new(&env));
        
        let reward_data = RewardData {
            pool_id: pool_id.clone(),
            amount,
            multiplier,
            last_updated: env.ledger().timestamp(),
        };
        
        rewards.set(pool_id.clone(), reward_data);
        env.storage().instance().set(&DataKey::Rewards, &rewards);
        
        // Emit event
        env.events().publish((symbol_short!("reward"), symbol_short!("available")), (pool_id, amount, multiplier));
    }

    /// Update multiplier for a pool
    pub fn update_multiplier(env: Env, pool_id: Symbol, new_multiplier: u32) {
        let mut rewards: Map<Symbol, RewardData> = env.storage().instance().get(&DataKey::Rewards).unwrap_or(Map::new(&env));
        
        if let Some(mut reward_data) = rewards.get(pool_id.clone()) {
            reward_data.multiplier = new_multiplier;
            reward_data.last_updated = env.ledger().timestamp();
            rewards.set(pool_id.clone(), reward_data);
            env.storage().instance().set(&DataKey::Rewards, &rewards);
            
            // Emit event
            env.events().publish((symbol_short!("multiplier"), symbol_short!("updated")), (pool_id, new_multiplier));
        }
    }

    /// Get reward data for a pool
    pub fn get_reward(env: Env, pool_id: Symbol) -> Option<RewardData> {
        let rewards: Map<Symbol, RewardData> = env.storage().instance().get(&DataKey::Rewards).unwrap_or(Map::new(&env));
        rewards.get(pool_id)
    }

    /// Get all rewards
    pub fn get_all_rewards(env: Env) -> Vec<RewardData> {
        let rewards: Map<Symbol, RewardData> = env.storage().instance().get(&DataKey::Rewards).unwrap_or(Map::new(&env));
        let mut result = vec![&env];
        for (_, reward) in rewards.iter() {
            result.push_back(reward);
        }
        result
    }
}

mod test;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Events;
    use soroban_sdk::Env;

    #[test]
    fn test_add_reward() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardIndexer);
        let client = RewardIndexerClient::new(&env, &contract_id);

        client.init();

        let pool_id = symbol_short!("pool1");
        client.add_reward(&pool_id, &1000, &2);

        let reward = client.get_reward(&pool_id);
        assert_eq!(reward.unwrap().amount, 1000);
        assert_eq!(reward.unwrap().multiplier, 2);

        // Check event
        let events = env.events().all();
        assert_eq!(events.len(), 1);
    }
}