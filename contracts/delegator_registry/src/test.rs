#![cfg(test)]
use super::*;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(DelegatorRegistry, ());
    let client = DelegatorRegistryClient::new(env, &contract_id);
    client.initialize(&admin, &token_addr);
    (contract_id, token_addr, admin, Address::generate(env))
}

#[test]
fn test_delegate_and_undelegate() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_addr, admin, delegator) = setup(&env);
    let client = DelegatorRegistryClient::new(&env, &contract_id);
    let validator = Address::generate(&env);

    StellarAssetClient::new(&env, &token_addr).mint(&delegator, &1000);
    client.register_validator(&validator);

    client.delegate(&delegator, &validator, &500);

    let vinfo = client.get_validator(&validator);
    assert_eq!(vinfo.total_delegated, 500);
    assert_eq!(vinfo.delegator_count, 1);

    let pos = client.get_delegation(&delegator, &validator);
    assert_eq!(pos.amount, 500);

    client.undelegate(&delegator, &validator, &200);

    let vinfo = client.get_validator(&validator);
    assert_eq!(vinfo.total_delegated, 300);

    let pos = client.get_delegation(&delegator, &validator);
    assert_eq!(pos.amount, 300);
}

#[test]
fn test_reward_distribution_and_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_addr, admin, delegator) = setup(&env);
    let client = DelegatorRegistryClient::new(&env, &contract_id);
    let validator = Address::generate(&env);

    StellarAssetClient::new(&env, &token_addr).mint(&delegator, &1000);
    // Mint rewards to contract
    StellarAssetClient::new(&env, &token_addr).mint(&contract_id, &500);

    client.register_validator(&validator);
    client.delegate(&delegator, &validator, &1000);

    // Distribute 100 rewards to validator's delegators
    client.distribute_rewards(&validator, &100);

    let pending = client.get_pending_rewards(&delegator, &validator);
    assert_eq!(pending, 100);

    let claimed = client.claim_rewards(&delegator, &validator);
    assert_eq!(claimed, 100);

    // After claim, pending should be 0
    let pending_after = client.get_pending_rewards(&delegator, &validator);
    assert_eq!(pending_after, 0);
}

#[test]
fn test_slash_validator() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_addr, _admin, delegator) = setup(&env);
    let client = DelegatorRegistryClient::new(&env, &contract_id);
    let validator = Address::generate(&env);

    StellarAssetClient::new(&env, &token_addr).mint(&delegator, &1000);
    client.register_validator(&validator);
    client.delegate(&delegator, &validator, &1000);

    client.slash_validator(&validator, &200);

    let vinfo = client.get_validator(&validator);
    assert_eq!(vinfo.total_delegated, 800);
}

#[test]
fn test_multiple_delegators_reward_split() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_addr, _admin, _) = setup(&env);
    let client = DelegatorRegistryClient::new(&env, &contract_id);
    let validator = Address::generate(&env);

    let d1 = Address::generate(&env);
    let d2 = Address::generate(&env);

    StellarAssetClient::new(&env, &token_addr).mint(&d1, &1000);
    StellarAssetClient::new(&env, &token_addr).mint(&d2, &1000);
    StellarAssetClient::new(&env, &token_addr).mint(&contract_id, &1000);

    client.register_validator(&validator);
    client.delegate(&d1, &validator, &500);
    client.delegate(&d2, &validator, &500);

    // 1000 total delegated, distribute 100 rewards -> 50 each
    client.distribute_rewards(&validator, &100);

    let p1 = client.get_pending_rewards(&d1, &validator);
    let p2 = client.get_pending_rewards(&d2, &validator);
    assert_eq!(p1, 50);
    assert_eq!(p2, 50);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_addr, admin, _) = setup(&env);
    let client = DelegatorRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr);
}

#[test]
#[should_panic(expected = "Insufficient delegation")]
fn test_undelegate_more_than_staked_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_addr, _admin, delegator) = setup(&env);
    let client = DelegatorRegistryClient::new(&env, &contract_id);
    let validator = Address::generate(&env);

    StellarAssetClient::new(&env, &token_addr).mint(&delegator, &500);
    client.register_validator(&validator);
    client.delegate(&delegator, &validator, &500);
    client.undelegate(&delegator, &validator, &600);
}
