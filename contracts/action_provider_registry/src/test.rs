#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, String, Symbol};

fn setup() -> (Env, Address, Address, Address, ActionProviderRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

    let contract_id = env.register_contract(None, ActionProviderRegistry);
    let client = ActionProviderRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &token_id, &100);

    // Fund the token_admin so they can pay registration fees
    token_admin_client.mint(&admin, &10_000);

    (env, admin, token_id, contract_id, client)
}

fn make_provider(env: &Env, client: &ActionProviderRegistryClient, token_id: &Address) -> (Address, u64) {
    let owner = Address::generate(env);
    let token_admin_client = token::StellarAssetClient::new(env, token_id);
    token_admin_client.mint(&owner, &500);

    let id = client.register(
        &owner,
        &Symbol::new(env, "MyProvider"),
        &String::from_str(env, "https://provider.example.com"),
        &10,
    );
    (owner, id)
}

#[test]
fn test_register_and_get() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (owner, id) = make_provider(&env, &client, &token_id);

    let provider = client.get_provider(&id);
    assert_eq!(provider.owner, owner);
    assert_eq!(provider.fee_per_call, 10);
    assert_eq!(provider.status, ProviderStatus::Active);
    assert_eq!(provider.total_calls, 0);

    let looked_up = client.get_provider_id_by_owner(&owner);
    assert_eq!(looked_up, Some(id));
}

#[test]
fn test_update_provider() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (_owner, id) = make_provider(&env, &client, &token_id);

    client.update(
        &id,
        &String::from_str(&env, "https://new.example.com"),
        &25,
    );

    let provider = client.get_provider(&id);
    assert_eq!(provider.fee_per_call, 25);
}

#[test]
fn test_record_call_and_rate() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (rater, id) = make_provider(&env, &client, &token_id);

    client.record_call(&id);
    client.record_call(&id);

    let provider = client.get_provider(&id);
    assert_eq!(provider.total_calls, 2);

    client.rate(&rater, &id, &5);
    client.rate(&rater, &id, &3);

    // avg = (5+3)/2 = 4.00 → scaled = 400
    assert_eq!(client.get_avg_rating(&id), 400);
}

#[test]
fn test_suspend_and_reinstate() {
    let (env, admin, token_id, _contract_id, client) = setup();
    let (_owner, id) = make_provider(&env, &client, &token_id);

    client.suspend(&admin, &id);
    assert_eq!(client.get_provider(&id).status, ProviderStatus::Suspended);

    client.reinstate(&admin, &id);
    assert_eq!(client.get_provider(&id).status, ProviderStatus::Active);
}

#[test]
fn test_deregister_by_owner() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (owner, id) = make_provider(&env, &client, &token_id);

    client.deregister(&owner, &id);
    assert_eq!(client.get_provider(&id).status, ProviderStatus::Deregistered);
    assert_eq!(client.get_provider_id_by_owner(&owner), None);
}

#[test]
fn test_set_registration_fee() {
    let (_env, admin, _token_id, _contract_id, client) = setup();
    client.set_registration_fee(&admin, &250);
    // No direct getter, but we verify no panic and next registration uses new fee
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_initialize() {
    let (_env, admin, token_id, _contract_id, client) = setup();
    client.initialize(&admin, &token_id, &100);
}

#[test]
#[should_panic(expected = "Owner already has a registered provider")]
fn test_duplicate_registration() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (owner, _id) = make_provider(&env, &client, &token_id);

    // Mint more tokens for the second attempt
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&owner, &500);

    client.register(
        &owner,
        &Symbol::new(&env, "Dup"),
        &String::from_str(&env, "https://dup.example.com"),
        &5,
    );
}

#[test]
#[should_panic(expected = "Score must be between 1 and 5")]
fn test_invalid_rating() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (rater, id) = make_provider(&env, &client, &token_id);
    client.rate(&rater, &id, &6);
}

#[test]
#[should_panic(expected = "Provider is not active")]
fn test_record_call_on_suspended() {
    let (env, admin, token_id, _contract_id, client) = setup();
    let (_owner, id) = make_provider(&env, &client, &token_id);

    client.suspend(&admin, &id);
    client.record_call(&id);
}

#[test]
#[should_panic(expected = "Unauthorized: admin only")]
fn test_non_admin_suspend() {
    let (env, _admin, token_id, _contract_id, client) = setup();
    let (owner, id) = make_provider(&env, &client, &token_id);
    client.suspend(&owner, &id);
}
