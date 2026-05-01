#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

fn setup() -> (Env, Address, Address, TokenWrapperClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = 10;
        l.timestamp = 1000;
    });

    let admin = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &asset).mint(&admin, &1_000_000);

    let contract_id = env.register(TokenWrapper, (&asset,));
    let client = TokenWrapperClient::new(&env, &contract_id);
    (env, admin, asset, client)
}

// ── Metadata ──────────────────────────────────────────────────────────────────

#[test]
fn test_metadata_mirrored() {
    let (env, _admin, underlying, client) = setup();
    let uc = TokenClient::new(&env, &underlying);

    assert_eq!(client.decimals(), uc.decimals());

    let expected_name = {
        let mut s = String::from_str(&env, "Wrapped ");
        s.append(&uc.name());
        s
    };
    assert_eq!(client.name(), expected_name);

    let expected_sym = {
        let mut s = String::from_str(&env, "w");
        s.append(&uc.symbol());
        s
    };
    assert_eq!(client.symbol(), expected_sym);
}

#[test]
fn test_underlying_asset_accessor() {
    let (_env, _admin, underlying, client) = setup();
    assert_eq!(client.underlying_asset(), underlying);
}

// ── Wrap / Unwrap ─────────────────────────────────────────────────────────────

#[test]
fn test_wrap_mints_1_to_1() {
    let (env, admin, underlying, client) = setup();
    let uc = TokenClient::new(&env, &underlying);

    client.wrap(&admin, &500);

    assert_eq!(client.balance(&admin), 500);
    assert_eq!(uc.balance(&admin), 1_000_000 - 500);
    assert_eq!(uc.balance(&client.address), 500);
}

#[test]
fn test_unwrap_returns_underlying() {
    let (env, admin, underlying, client) = setup();
    let uc = TokenClient::new(&env, &underlying);

    client.wrap(&admin, &300);
    client.unwrap(&admin, &300);

    assert_eq!(client.balance(&admin), 0);
    assert_eq!(uc.balance(&admin), 1_000_000);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_unwrap_more_than_wrapped_panics() {
    let (env, admin, _underlying, client) = setup();
    client.wrap(&admin, &100);
    client.unwrap(&admin, &200);
}

// ── Transfer ──────────────────────────────────────────────────────────────────

#[test]
fn test_transfer() {
    let (env, admin, _underlying, client) = setup();
    let user = Address::generate(&env);

    client.wrap(&admin, &1000);
    client.transfer(&admin, &user, &400);

    assert_eq!(client.balance(&admin), 600);
    assert_eq!(client.balance(&user), 400);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_insufficient_panics() {
    let (env, admin, _underlying, client) = setup();
    let user = Address::generate(&env);
    client.wrap(&admin, &100);
    client.transfer(&admin, &user, &200);
}

// ── Approve / transfer_from ───────────────────────────────────────────────────

#[test]
fn test_approve_and_transfer_from() {
    let (env, admin, _underlying, client) = setup();
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.wrap(&admin, &1000);
    client.approve(&admin, &spender, &500, &100);
    assert_eq!(client.allowance(&admin, &spender), 500);

    client.transfer_from(&spender, &admin, &recipient, &300);
    assert_eq!(client.balance(&admin), 700);
    assert_eq!(client.balance(&recipient), 300);
    assert_eq!(client.allowance(&admin, &spender), 200);
}

#[test]
#[should_panic(expected = "insufficient allowance")]
fn test_transfer_from_exceeds_allowance_panics() {
    let (env, admin, _underlying, client) = setup();
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.wrap(&admin, &1000);
    client.approve(&admin, &spender, &100, &100);
    client.transfer_from(&spender, &admin, &recipient, &200);
}

// ── Burn ──────────────────────────────────────────────────────────────────────

#[test]
fn test_burn() {
    let (env, admin, _underlying, client) = setup();
    client.wrap(&admin, &500);
    client.burn(&admin, &200);
    assert_eq!(client.balance(&admin), 300);
}

#[test]
fn test_burn_from() {
    let (env, admin, _underlying, client) = setup();
    let spender = Address::generate(&env);

    client.wrap(&admin, &500);
    client.approve(&admin, &spender, &300, &100);
    client.burn_from(&spender, &admin, &300);

    assert_eq!(client.balance(&admin), 200);
    assert_eq!(client.allowance(&admin, &spender), 0);
}
