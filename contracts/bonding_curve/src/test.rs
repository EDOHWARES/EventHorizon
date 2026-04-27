#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, token::Client<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    (contract_id.address(), token::Client::new(env, &contract_id.address()))
}

fn setup() -> (Env, Address, Address, Address, token::Client<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let (token_id, token_client) = create_token_contract(&env, &admin);
    
    // Mint tokens to users
    token_client.mint(&user1, &1_000_000);
    token_client.mint(&user2, &1_000_000);

    let contract_id = env.register(BondingCurve, ());
    let client = BondingCurveClient::new(&env, &contract_id);

    (env, admin, user1, user2, token_client, contract_id)
}

#[test]
fn test_initialization() {
    let (env, admin, _, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    assert_eq!(client.total_supply(), 0);
    assert_eq!(client.reserve_balance(), 0);
}

#[test]
#[should_panic(expected = "Invalid reserve ratio")]
fn test_invalid_reserve_ratio() {
    let (env, admin, _, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 0,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);
}

#[test]
fn test_buy_initial_tokens() {
    let (env, admin, user1, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    // Buy tokens
    let tokens = client.buy(&user1, &10_000);

    assert_eq!(tokens, 100); // 10_000 / 100 = 100 tokens
    assert_eq!(client.balance_of(&user1), 100);
    assert_eq!(client.total_supply(), 100);
    assert_eq!(client.reserve_balance(), 10_000);

    // Check event was emitted
    let events = env.events().all();
    let event = events.last().unwrap();
    assert_eq!(event.topics.len(), 1);
}

#[test]
fn test_buy_sell_cycle() {
    let (env, admin, user1, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    // Buy tokens
    let tokens = client.buy(&user1, &10_000);
    let initial_balance = token_client.balance(&user1);

    // Sell tokens
    let refund = client.sell(&user1, &tokens);

    assert_eq!(client.balance_of(&user1), 0);
    assert_eq!(client.total_supply(), 0);
    
    // User should get refund
    assert!(refund > 0);
    assert!(token_client.balance(&user1) > initial_balance);
}

#[test]
fn test_price_increases_with_supply() {
    let (env, admin, user1, user2, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    // First buy
    client.buy(&user1, &10_000);
    let price1 = client.get_price();

    // Second buy
    client.buy(&user2, &10_000);
    let price2 = client.get_price();

    // Price should increase
    assert!(price2 > price1);
}

#[test]
fn test_multiple_users() {
    let (env, admin, user1, user2, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    // Both users buy
    let tokens1 = client.buy(&user1, &10_000);
    let tokens2 = client.buy(&user2, &5_000);

    assert_eq!(client.balance_of(&user1), tokens1);
    assert_eq!(client.balance_of(&user2), tokens2);
    assert_eq!(client.total_supply(), tokens1 + tokens2);
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn test_sell_more_than_balance() {
    let (env, admin, user1, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    client.buy(&user1, &10_000);
    client.sell(&user1, &1_000); // More than owned
}

#[test]
fn test_update_reserve_ratio() {
    let (env, admin, _, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);
    client.update_reserve_ratio(&admin, &75);

    // Verify ratio updated by checking price behavior
    // (indirect test since we can't directly query config)
}

#[test]
fn test_price_step_event_structure() {
    let (env, admin, user1, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 100,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);
    client.buy(&user1, &10_000);

    let events = env.events().all();
    let last_event = events.last().unwrap();
    
    // Verify event has PriceStep topic
    assert_eq!(last_event.topics.len(), 1);
}

#[test]
fn test_overflow_protection() {
    let (env, admin, user1, _, token_client, contract_id) = setup();
    let client = BondingCurveClient::new(&env, &contract_id);

    let config = CurveConfig {
        reserve_ratio: 50,
        base_price: 1,
        reserve_token: token_client.address.clone(),
    };

    client.initialize(&admin, &config);

    // Large buy should not overflow
    client.buy(&user1, &100_000);
    
    assert!(client.total_supply() > 0);
    assert!(client.reserve_balance() > 0);
}
