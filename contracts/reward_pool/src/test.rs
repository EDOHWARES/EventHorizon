#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

const SCALAR: i128 = 1_000_000;
const REWARD_PER_WINDOW: i128 = 10 * SCALAR; // 10 tokens per window
const PENALTY_PER_WINDOW: i128 = 2 * SCALAR; //  2 tokens per missed window

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let node = Address::generate(&env);

    // Create a Stellar asset for rewards
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let reward_token = token_contract.address();

    // Mint tokens to admin so the pool can be funded
    let asset_client = StellarAssetClient::new(&env, &reward_token);
    asset_client.mint(&admin, &1_000_000_000);

    // Deploy and initialize the reward pool
    let contract_id = env.register(RewardPoolContract, ());
    let client = RewardPoolContractClient::new(&env, &contract_id);
    client.initialize(&admin, &reward_token, &REWARD_PER_WINDOW, &PENALTY_PER_WINDOW);

    // Fund the pool
    client.fund(&admin, &500_000_000);

    (env, contract_id, reward_token, admin, node)
}

#[test]
fn test_report_and_claim_full_uptime() {
    let (env, contract_id, reward_token, _admin, node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);

    // Node reports 10/10 windows (100% uptime)
    client.report(&node, &10, &10);

    let info = client.get_node_info(&node);
    // earned = 10 * REWARD_PER_WINDOW / SCALAR = 10 * 10 = 100
    assert_eq!(info.pending_rewards, 100);
    assert_eq!(info.windows_reported, 10);
    assert_eq!(info.windows_expected, 10);

    let uptime = client.get_uptime_ratio(&node);
    assert_eq!(uptime, SCALAR); // 100%

    let token_client = TokenClient::new(&env, &reward_token);
    let before = token_client.balance(&node);
    let claimed = client.claim(&node);
    assert_eq!(claimed, 100);
    assert_eq!(token_client.balance(&node) - before, 100);

    // Pending rewards reset to 0
    let info_after = client.get_node_info(&node);
    assert_eq!(info_after.pending_rewards, 0);
}

#[test]
fn test_report_with_missed_windows_applies_penalty() {
    let (env, contract_id, _reward_token, _admin, node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);

    // Node reports 8/10 windows (2 missed)
    client.report(&node, &8, &10);

    let info = client.get_node_info(&node);
    // earned = 8 * 10 = 80, penalty = 2 * 2 = 4, net = 76
    assert_eq!(info.pending_rewards, 76);

    let uptime = client.get_uptime_ratio(&node);
    // 8/10 * SCALAR = 800_000
    assert_eq!(uptime, 800_000);
}

#[test]
fn test_penalty_cannot_make_rewards_negative() {
    let (env, contract_id, _reward_token, _admin, node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);

    // Report 0/10 windows — penalty would exceed earned
    client.report(&node, &0, &10);

    let info = client.get_node_info(&node);
    // earned = 0, penalty = 10 * 2 = 20, saturating_sub → 0
    assert_eq!(info.pending_rewards, 0);
}

#[test]
fn test_multiple_reports_accumulate() {
    let (env, contract_id, _reward_token, _admin, node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);

    client.report(&node, &5, &5); // +50
    client.report(&node, &5, &5); // +50

    let info = client.get_node_info(&node);
    assert_eq!(info.pending_rewards, 100);
    assert_eq!(info.windows_expected, 10);
    assert_eq!(info.windows_reported, 10);
}

#[test]
#[should_panic(expected = "No rewards to claim")]
fn test_claim_with_no_rewards_panics() {
    let (env, contract_id, _reward_token, _admin, node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);

    // Report 0/5 windows so pending_rewards stays 0 (penalty saturates)
    client.report(&node, &0, &5);
    client.claim(&node);
}

#[test]
#[should_panic(expected = "windows_reported cannot exceed windows_expected")]
fn test_report_more_than_expected_panics() {
    let (env, contract_id, _reward_token, _admin, node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);
    client.report(&node, &11, &10);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let (env, contract_id, reward_token, admin, _node) = setup();
    let client = RewardPoolContractClient::new(&env, &contract_id);
    client.initialize(&admin, &reward_token, &REWARD_PER_WINDOW, &PENALTY_PER_WINDOW);
}
