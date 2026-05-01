#![cfg(test)]
use super::*;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn test_dividend_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup participants
    let admin = Address::generate(&env);
    let staking_contract_addr = Address::generate(&env); // Mock staking contract

    // Register dividend token
    let dividend_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let dividend_admin = StellarAssetClient::new(&env, &dividend_token_addr);
    let dividend_token = TokenClient::new(&env, &dividend_token_addr);

    // Register dividend distribution contract
    let contract_id = env.register(DividendDistributionContract, ());
    let client = DividendDistributionContractClient::new(&env, &contract_id);

    // Initialize contract
    let initial_pool = 1000000000i128; // 1000 tokens
    dividend_admin.mint(&admin, &initial_pool);
    client.initialize(&admin, &staking_contract_addr, &dividend_token_addr, &86400, &initial_pool);

    // Start new epoch
    client.start_new_epoch(&admin);

    // Calculate dividends (mock data)
    let epoch_id = 1;
    let dividends = client.calculate_dividends(&epoch_id);
    assert!(!dividends.is_empty()); // Assuming mock returns some dividends

    // Distribute dividends
    client.distribute_dividends(&epoch_id);

    // Check epoch report
    let (epoch_info, dividend_list) = client.get_epoch_report(&epoch_id);
    assert_eq!(epoch_info.epoch_id, epoch_id);
    assert!(epoch_info.distributed);
    assert_eq!(dividend_list.len(), dividends.len());
}

#[test]
fn test_process_epoch() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup
    let admin = Address::generate(&env);
    let staking_contract_addr = Address::generate(&env);

    let dividend_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let dividend_admin = StellarAssetClient::new(&env, &dividend_token_addr);

    let contract_id = env.register(DividendDistributionContract, ());
    let client = DividendDistributionContractClient::new(&env, &contract_id);

    let initial_pool = 1000000000i128;
    dividend_admin.mint(&admin, &initial_pool);
    client.initialize(&admin, &staking_contract_addr, &dividend_token_addr, &86400, &initial_pool);

    client.start_new_epoch(&admin);

    // Advance time past epoch end
    env.ledger().set_timestamp(86401);

    // Process epoch
    client.process_epoch(&admin);

    // Check if distributed
    let (epoch_info, _) = client.get_epoch_report(&1);
    assert!(epoch_info.distributed);
}