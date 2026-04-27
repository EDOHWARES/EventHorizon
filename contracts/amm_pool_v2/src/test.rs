#![cfg(test)]
use super::*;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup_pool(env: &Env) -> (Address, Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let user = Address::generate(env);

    let token_a_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();

    StellarAssetClient::new(env, &token_a_addr).mint(&user, &10_000);
    StellarAssetClient::new(env, &token_b_addr).mint(&user, &10_000);

    let contract_id = env.register(AmmPoolV2, ());
    let client = AmmPoolV2Client::new(env, &contract_id);
    client.initialize(&token_a_addr, &token_b_addr);

    (contract_id, token_a_addr, token_b_addr, user, admin)
}

#[test]
fn test_add_liquidity_and_spot_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_a_addr, _token_b_addr, user, _admin) = setup_pool(&env);
    let client = AmmPoolV2Client::new(&env, &contract_id);

    client.add_liquidity(&user, &1000, &2000);

    let (ra, rb, supply) = client.get_pool_info();
    assert_eq!(ra, 1000);
    assert_eq!(rb, 2000);
    assert!(supply > 0);

    // Spot price of A in B = 2000 * 1e7 / 1000 = 20_000_000
    let spot = client.get_spot_price();
    assert_eq!(spot, 20_000_000);
}

#[test]
fn test_swap_emits_price_impact() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_a_addr, _token_b_addr, user, _admin) = setup_pool(&env);
    let client = AmmPoolV2Client::new(&env, &contract_id);

    client.add_liquidity(&user, &1000, &1000);

    let amount_out = client.swap(&user, &token_a_addr, &100, &80);
    assert!(amount_out >= 80);

    // Volume should be updated
    let (va, vb, count) = client.get_cumulative_volume();
    assert_eq!(va, 100);
    assert!(vb > 0);
    assert_eq!(count, 1);
}

#[test]
fn test_multiple_swaps_accumulate_volume() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_a_addr, _token_b_addr, user, _admin) = setup_pool(&env);
    let client = AmmPoolV2Client::new(&env, &contract_id);

    client.add_liquidity(&user, &5000, &5000);

    client.swap(&user, &token_a_addr, &100, &80);
    client.swap(&user, &token_a_addr, &100, &80);
    client.swap(&user, &token_a_addr, &100, &70);

    let (_va, _vb, count) = client.get_cumulative_volume();
    assert_eq!(count, 3);
}

#[test]
#[should_panic(expected = "Slippage limit exceeded")]
fn test_swap_slippage_guard() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_a_addr, _token_b_addr, user, _admin) = setup_pool(&env);
    let client = AmmPoolV2Client::new(&env, &contract_id);

    client.add_liquidity(&user, &1000, &1000);
    // Require 99 out but only ~90 is possible
    client.swap(&user, &token_a_addr, &100, &99);
}

#[test]
fn test_remove_liquidity() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _token_a_addr, _token_b_addr, user, _admin) = setup_pool(&env);
    let client = AmmPoolV2Client::new(&env, &contract_id);

    let lp = client.add_liquidity(&user, &1000, &1000);
    let (ra, rb) = client.remove_liquidity(&user, &(lp / 2));
    assert!(ra > 0);
    assert!(rb > 0);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, token_a_addr, token_b_addr, _user, _admin) = setup_pool(&env);
    let client = AmmPoolV2Client::new(&env, &contract_id);
    client.initialize(&token_a_addr, &token_b_addr);
}
