#![cfg(test)]
use super::*;
use soroban_sdk::{symbol_short, testutils::Events, Env};

#[test]
fn test_add_reward() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RewardIndexer);
    let client = RewardIndexerClient::new(&env, &contract_id);

    client.init();

    let pool_id = symbol_short!("pool1");
    client.add_reward(&pool_id, &1000, &2);

    let reward = client.get_reward(&pool_id);
    assert!(reward.is_some());
    let reward = reward.unwrap();
    assert_eq!(reward.amount, 1000);
    assert_eq!(reward.multiplier, 2);
    assert_eq!(reward.pool_id, pool_id);

    // Check event
    let events = env.events().all();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, (symbol_short!("reward"), symbol_short!("available")));
    assert_eq!(events[0].1, (pool_id, 1000_i128, 2_u32));
}

#[test]
fn test_update_multiplier() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RewardIndexer);
    let client = RewardIndexerClient::new(&env, &contract_id);

    client.init();

    let pool_id = symbol_short!("pool1");
    client.add_reward(&pool_id, &1000, &2);
    client.update_multiplier(&pool_id, &3);

    let reward = client.get_reward(&pool_id).unwrap();
    assert_eq!(reward.multiplier, 3);

    // Check events
    let events = env.events().all();
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].0, (symbol_short!("multiplier"), symbol_short!("updated")));
    assert_eq!(events[1].1, (pool_id, 3_u32));
}

#[test]
fn test_get_all_rewards() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RewardIndexer);
    let client = RewardIndexerClient::new(&env, &contract_id);

    client.init();

    let pool1 = symbol_short!("pool1");
    let pool2 = symbol_short!("pool2");
    client.add_reward(&pool1, &1000, &2);
    client.add_reward(&pool2, &2000, &1);

    let all_rewards = client.get_all_rewards();
    assert_eq!(all_rewards.len(), 2);
    // Note: order may vary, but check contents
}