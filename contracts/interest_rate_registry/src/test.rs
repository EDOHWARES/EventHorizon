#![cfg(test)]
use super::*;
use soroban_sdk::{symbol_short, testutils::Events, Env};

#[test]
fn test_update_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, InterestRateRegistry);
    let client = InterestRateRegistryClient::new(&env, &contract_id);

    client.init();

    let pool_id = symbol_short!("pool1");
    client.update_rate(&pool_id, &80, &500);

    let rate = client.get_rate(&pool_id);
    assert!(rate.is_some());
    let rate = rate.unwrap();
    assert_eq!(rate.utilization, 80);
    assert_eq!(rate.interest_rate, 500);

    // Check event
    let events = env.events().all();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, (symbol_short!("rate"), symbol_short!("updated")));
}

#[test]
fn test_rate_spike_warning() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, InterestRateRegistry);
    let client = InterestRateRegistryClient::new(&env, &contract_id);

    client.init();

    let pool_id = symbol_short!("pool1");
    client.update_rate(&pool_id, &90, &6000); // spike

    // Check spike event
    let events = env.events().all();
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].0, (symbol_short!("rate"), symbol_short!("spike")));
}