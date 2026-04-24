#![cfg(test)]
use super::*;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn test_linear_vesting_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup participants
    let recipient = Address::generate(&env);
    let employer = Address::generate(&env);
    
    // Register mock token (using the employer as admin)
    // In SDK 20.0.0, we use register_stellar_asset_contract
    let token_addr = env.register_stellar_asset_contract_v2(employer.clone()).address();
    let token_admin = StellarAssetClient::new(&env, &token_addr);
    let token = TokenClient::new(&env, &token_addr);

    // Register vesting contract
    let contract_id = env.register(TokenVesting, ());
    let client = TokenVestingClient::new(&env, &contract_id);

    // Initial configuration
    let total_amount = 1_000_000_000_i128;
    let start_ts = 1000;
    let cliff_ts = 1500;
    let end_ts = 2000;
    let clawback_admin = employer.clone();
    
    // 1. Initial funding: mint tokens to the vesting contract
    token_admin.mint(&contract_id, &total_amount);
    assert_eq!(token.balance(&contract_id), total_amount);
    
    // 2. Initialize the contract
    client.initialize(
        &recipient,
        &token_addr,
        &total_amount,
        &start_ts,
        &cliff_ts,
        &end_ts,
        &clawback_admin,
    );

    // 3. Test before start
    env.ledger().set_timestamp(500);
    assert_eq!(client.get_vested_amount(), 0);
    assert_eq!(client.get_claimable_amount(), 0);

    // 4. Test at start (before cliff)
    env.ledger().set_timestamp(1000);
    assert_eq!(client.get_vested_amount(), 0);
    
    // 5. Test mid cliff
    env.ledger().set_timestamp(1250);
    assert_eq!(client.get_vested_amount(), 0);

    // 6. Test at cliff (exact)
    // Calculation: total * (1500 - 1000) / (2000 - 1000) = total * 0.5
    env.ledger().set_timestamp(1500);
    assert_eq!(client.get_vested_amount(), 500_000_000);
    assert_eq!(client.get_claimable_amount(), 500_000_000);

    // 7. Claim at cliff
    let claimed = client.claim();
    assert_eq!(claimed, 500_000_000);
    assert_eq!(token.balance(&recipient), 500_000_000);
    assert_eq!(client.get_claimable_amount(), 0);

    // 8. Test mid linear phase
    // Calculation: total * (1750 - 1000) / (2000 - 1000) = total * 0.75 = 750,000,000
    // Claimable: 750,000,000 - 500,000,000 = 250,000,000
    env.ledger().set_timestamp(1750);
    assert_eq!(client.get_vested_amount(), 750_000_000);
    assert_eq!(client.get_claimable_amount(), 250_000_000);
    
    let claimed2 = client.claim();
    assert_eq!(claimed2, 250_000_000);
    assert_eq!(token.balance(&recipient), 750_000_000);

    // 9. Test end of vesting
    env.ledger().set_timestamp(2000);
    assert_eq!(client.get_vested_amount(), total_amount);
    assert_eq!(client.get_claimable_amount(), 250_000_000);
    
    client.claim();
    assert_eq!(token.balance(&recipient), total_amount);
    assert_eq!(client.get_claimable_amount(), 0);

    // 10. After end
    env.ledger().set_timestamp(3000);
    assert_eq!(client.get_vested_amount(), total_amount);
    assert_eq!(client.claim(), 0);
}

#[test]
#[should_panic(expected = "Contract already initialized")]
fn test_double_initialization() {
    let env = Env::default();
    let contract_id = env.register(TokenVesting, ());
    let client = TokenVestingClient::new(&env, &contract_id);
    let addr = Address::generate(&env);

    let clawback_admin = Address::generate(&env);
    client.initialize(&addr, &addr, &1000, &100, &100, &200, &clawback_admin);
    client.initialize(&addr, &addr, &1000, &100, &100, &200, &clawback_admin);
}

#[test]
#[should_panic]
fn test_unauthorized_claim() {
    let env = Env::default();
    let recipient = Address::generate(&env);
    let _attacker = Address::generate(&env);
    
    let contract_id = env.register(TokenVesting, ());
    let client = TokenVestingClient::new(&env, &contract_id);
    let token_addr = Address::generate(&env);
    let clawback_admin = Address::generate(&env);

    client.initialize(&recipient, &token_addr, &1000, &100, &100, &200, &clawback_admin);
    
    // Attacker tries to claim (will fail because mock_all_auths is not called or recipient didn't sign)
    client.claim(); 
}

#[test]
fn test_clawback_by_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let recipient = Address::generate(&env);
    let employer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(employer.clone()).address();
    let token_admin = StellarAssetClient::new(&env, &token_addr);
    let token = TokenClient::new(&env, &token_addr);
    let contract_id = env.register(TokenVesting, ());
    let client = TokenVestingClient::new(&env, &contract_id);

    let total_amount = 1_000_000_i128;
    let start_ts = 100;
    let cliff_ts = 200;
    let end_ts = 300;
    let clawback_admin = employer.clone();

    token_admin.mint(&contract_id, &total_amount);
    client.initialize(
        &recipient,
        &token_addr,
        &total_amount,
        &start_ts,
        &cliff_ts,
        &end_ts,
        &clawback_admin,
    );

    env.ledger().set_timestamp(250);
    assert_eq!(client.get_vested_amount(), 150_000_i128);

    let reclaim_destination = Address::generate(&env);
    let reclaimed = client.clawback(&reclaim_destination);
    assert_eq!(reclaimed, 850_000_i128);
    assert_eq!(token.balance(&reclaim_destination), 850_000_i128);
    assert_eq!(client.get_vested_amount(), 150_000_i128);
    assert_eq!(client.get_claimable_amount(), 150_000_i128);
}

#[test]
#[should_panic]
fn test_unauthorized_clawback() {
    let env = Env::default();
    let recipient = Address::generate(&env);
    let attacker = Address::generate(&env);
    let token_addr = Address::generate(&env);
    let clawback_admin = Address::generate(&env);

    let contract_id = env.register(TokenVesting, ());
    let client = TokenVestingClient::new(&env, &contract_id);

    client.initialize(&recipient, &token_addr, &1000, &100, &150, &200, &clawback_admin);

    // Attacker tries to reclaim tokens without admin authorization.
    client.clawback(&attacker);
}

#[test]
fn test_get_info() {
    let env = Env::default();
    let recipient = Address::generate(&env);
    let contract_id = env.register(TokenVesting, ());
    let client = TokenVestingClient::new(&env, &contract_id);
    let token_addr = Address::generate(&env);
    let clawback_admin = Address::generate(&env);

    client.initialize(&recipient, &token_addr, &1000, &100, &150, &200, &clawback_admin);
    
    let (addr, total, claimed, start, end) = client.get_info();
    assert_eq!(addr, recipient);
    assert_eq!(total, 1000);
    assert_eq!(claimed, 0);
    assert_eq!(start, 100);
    assert_eq!(end, 200);
}
