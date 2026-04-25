#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn test_market_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Deploy token
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token = token::Client::new(&env, &token_id);
    
    // Deploy contract
    let contract_id = env.register_contract(None, PredictionResolutionEngine);
    let client = PredictionResolutionEngineClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    
    // Setup funds
    token.mint(&creator, &10000);
    token.mint(&user, &5000);
    
    // 1. Create Market
    let deadline = 1000;
    let initial_liquidity = 1000;
    let market_id = client.create_market(&creator, &token_id, &2, &oracle, &deadline, &initial_liquidity);
    
    assert_eq!(market_id, 0);
    
    // 2. Buy Shares
    client.buy_shares(&user, &market_id, &0, &500);
    
    // 3. Check Analysis
    let analysis = client.get_market_analysis(&market_id);
    assert_eq!(analysis.total_volume, initial_liquidity + 500);
    // Probabilities should reflect the change
    // Initial: 1000 total, 500 per outcome. 50% / 50%
    // After buying 500 outcome 0: 1500 total, 1000 outcome 0, 500 outcome 1. 66% / 33%
    assert!(analysis.probabilities.get(0).unwrap() > 6000);
    
    // 4. Resolve Market
    client.resolve_market(&market_id, &0);
    
    // 5. Claim Payout
    let payout = client.claim_payout(&user, &market_id);
    assert!(payout > 500); // User put 500, outcome 0 won
}

#[test]
#[should_panic(expected = "Market locked")]
fn test_trade_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let user = Address::generate(&env);
    
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    let token = token::Client::new(&env, &token_id);
    
    let contract_id = env.register_contract(None, PredictionResolutionEngine);
    let client = PredictionResolutionEngineClient::new(&env, &contract_id);
    
    client.initialize(&admin);
    token.mint(&creator, &2000);
    token.mint(&user, &1000);
    
    let deadline = 100;
    let market_id = client.create_market(&creator, &token_id, &2, &oracle, &deadline, &1000);
    
    // Advance Ledger time
    env.ledger().with_mut(|li| {
        li.timestamp = 200;
    });
    
    client.buy_shares(&user, &market_id, &0, &100);
}
