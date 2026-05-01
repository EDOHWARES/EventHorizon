#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, symbol_short, testutils::Events, Env};

#[test]
fn test_register_poller() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PollerReputationQueue);
    let client = PollerReputationQueueClient::new(&env, &contract_id);

    client.init();

    let poller = Address::generate(&env);
    client.register_poller(&poller);

    let data = client.get_poller(&poller);
    assert!(data.is_some());
    let data = data.unwrap();
    assert_eq!(data.reputation, 50);
    assert_eq!(data.uptime, 100);
}

#[test]
fn test_update_performance_slash() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PollerReputationQueue);
    let client = PollerReputationQueueClient::new(&env, &contract_id);

    client.init();

    let poller = Address::generate(&env);
    client.register_poller(&poller);
    client.update_performance(&poller, &95, &false); // late

    let data = client.get_poller(&poller).unwrap();
    assert_eq!(data.reputation, 45); // slashed

    // Check slash event
    let events = env.events().all();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, (symbol_short!("poller"), symbol_short!("slashed")));
}