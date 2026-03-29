#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, String};

#[test]
fn test_initialize_and_mint() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register_contract(None, NftFactory);
    let client = NftFactoryClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &String::from_str(&env, "EventHorizon NFTs"),
        &symbol_short!("EH"),
        &500,
    );

    let uri = String::from_str(&env, "ipfs://QmExample");
    let token_id = client.mint(&user, &uri, &750);

    assert_eq!(token_id, 0);
    assert_eq!(client.owner_of(&token_id), user);
    assert_eq!(client.total_supply(), 1);

    let meta = client.token_metadata(&token_id);
    assert_eq!(meta.uri, uri);

    let royalty = client.royalty_info(&token_id);
    assert_eq!(royalty.bps, 750);
    assert_eq!(royalty.recipient, user);
}

#[test]
fn test_batch_mint() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register_contract(None, NftFactory);
    let client = NftFactoryClient::new(&env, &contract_id);

    client.initialize(&admin, &String::from_str(&env, "Batch"), &symbol_short!("BATCH"), &0);

    let mut uris = Vec::new(&env);
    uris.push_back(String::from_str(&env, "ipfs://a"));
    uris.push_back(String::from_str(&env, "ipfs://b"));
    uris.push_back(String::from_str(&env, "ipfs://c"));

    let ids = client.batch_mint(&user, &uris, &1000);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0), Some(0));
    assert_eq!(ids.get(2), Some(2));
    assert_eq!(client.total_supply(), 3);
}

#[test]
fn test_default_royalty_fallback() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register_contract(None, NftFactory);
    let client = NftFactoryClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &String::from_str(&env, "Default Royalty Test"),
        &symbol_short!("DRT"),
        &300,
    );

    // Mint with 0 bps so default should NOT be used — royalty is stored per-token
    let uri = String::from_str(&env, "ipfs://token1");
    client.mint(&user, &uri, &0);
    let royalty = client.royalty_info(&0);
    assert_eq!(royalty.bps, 0); // per-token overrides default

    // Update default royalty
    client.set_default_royalty(&admin, &admin, &2000);

    // A non-existent token falls back to the new default
    let default = client.royalty_info(&999);
    assert_eq!(default.bps, 2000);
    assert_eq!(default.recipient, admin);
}

#[test]
#[should_panic(expected = "InvalidRoyaltyBps")]
fn test_invalid_royalty_bps() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register_contract(None, NftFactory);
    let client = NftFactoryClient::new(&env, &contract_id);

    client.initialize(&admin, &String::from_str(&env, "Bad"), &symbol_short!("BAD"), &0);
    client.mint(&user, &String::from_str(&env, "x"), &20_000);
}
