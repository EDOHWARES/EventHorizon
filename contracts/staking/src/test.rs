#![cfg(test)]
use super::*;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn test_staking_rewards_and_penalty() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup participants
    let user = Address::generate(&env);
    let admin = Address::generate(&env);
    
    // Register tokens
    let staking_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let reward_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    
    let staking_admin = StellarAssetClient::new(&env, &staking_token_addr);
    let reward_admin = StellarAssetClient::new(&env, &reward_token_addr);
    
    let staking_token = TokenClient::new(&env, &staking_token_addr);
    let reward_token = TokenClient::new(&env, &reward_token_addr);

    // Register staking contract
    let contract_id = env.register(StakingContract, ());
    let client = StakingContractClient::new(&env, &contract_id);

    // Initialization: 
    // Reward Rate: 100 units per token per day (scaled by 1e6)
    // Lock-up period: 1000 seconds
    // Penalty rate: 10% (1000 bps)
    let daily_rate = 100 * SCALAR / (24 * 60 * 60); // Roughly bits per token-second
    client.initialize(&admin, &staking_token_addr, &reward_token_addr, &daily_rate, &1000, &1000);

    // Initial funding
    staking_admin.mint(&user, &1000);
    reward_admin.mint(&contract_id, &1_000_000); // Fund contract with rewards

    // STAKE
    client.stake(&user, &1000);
    assert_eq!(staking_token.balance(&user), 0);
    assert_eq!(staking_token.balance(&contract_id), 1000);

    // ADVANCE TIME (Wait 500 seconds - still within lock-up)
    env.ledger().set_timestamp(500);
    let pending = client.get_pending_rewards(&user);
    assert!(pending > 0);

    // UNSTAKE EARLY (Expect exponential penalty)
    // base penalty = 10%, half-life = 200s
    // elapsed = 500s -> 2.5 half-lives
    // Penalty drops from 100 to 19. Total withdrawn: 1000 - 19 = 981
    // Rewards are also claimed
    let total_withdrawn = client.unstake(&user);
    assert_eq!(total_withdrawn, 981);
    assert_eq!(staking_token.balance(&user), 981);
    assert!(reward_token.balance(&user) > 0); // User got some rewards too

    // RESET AND RESTAKE for lock-up test
    staking_admin.mint(&user, &100); // Recover penalty for a clean 1000 stake
    client.stake(&user, &1000);
    env.ledger().set_timestamp(2000); // Beyond 1000s lock-up
    
    // UNSTAKE LATE (Expect no penalty)
    let total_withdrawn2 = client.unstake(&user);
    assert_eq!(total_withdrawn2, 1000);
    assert_eq!(staking_token.balance(&user), 1981); // 981 from earlier + 1000
}

#[test]
fn test_autopayout_on_restake() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let admin = Address::generate(&env);
    let staking_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let reward_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    
    let staking_admin = StellarAssetClient::new(&env, &staking_token_addr);
    let reward_admin = StellarAssetClient::new(&env, &reward_token_addr);
    let reward_token = TokenClient::new(&env, &reward_token_addr);

    let contract_id = env.register(StakingContract, ());
    let client = StakingContractClient::new(&env, &contract_id);

    client.initialize(&admin, &staking_token_addr, &reward_token_addr, &SCALAR, &0, &0);
    staking_admin.mint(&user, &2000);
    reward_admin.mint(&contract_id, &100000);

    // First stake
    client.stake(&user, &1000);
    
    // Wait
    env.ledger().set_timestamp(100);
    
    // Second stake (should trigger reward payout for first stake)
    client.stake(&user, &1000);
    
    // User should have rewards from first 100 seconds
    // 1000 * SCALAR * 100 / SCALAR = 100,000 ? 
    // Wait, the Scalar math: (Amount * Rate * Time) / Scalar
    // (1000 * 1,000,000 * 100) / 1,000,000 = 100,000
    assert_eq!(reward_token.balance(&user), 100_000);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_prevent_re_init() {
    let env = Env::default();
    let addr = Address::generate(&env);
    let contract_id = env.register(StakingContract, ());
    let client = StakingContractClient::new(&env, &contract_id);

    client.initialize(&addr, &addr, &addr, &1, &0, &0);
    client.initialize(&addr, &addr, &addr, &1, &0, &0);
}

#[test]
fn test_emergency_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let admin = Address::generate(&env);
    let staking_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let reward_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    
    let staking_admin = StellarAssetClient::new(&env, &staking_token_addr);
    let reward_admin = StellarAssetClient::new(&env, &reward_token_addr);
    
    let contract_id = env.register(StakingContract, ());
    let client = StakingContractClient::new(&env, &contract_id);

    client.initialize(&admin, &staking_token_addr, &reward_token_addr, &100, &1000, &5000);

    staking_admin.mint(&user, &1000);
    reward_admin.mint(&contract_id, &1_000_000);

    client.stake(&user, &1000);

    // Emergency withdraw, should bypass penalty and rewards
    let withdrawn = client.emergency_withdraw(&user);
    assert_eq!(withdrawn, 1000);
    
    let staking_token = TokenClient::new(&env, &staking_token_addr);
    assert_eq!(staking_token.balance(&user), 1000);
    
    // Total staked should be 0
    // Just to ensure nothing breaks, user can restake
    client.stake(&user, &1000);
}
