#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let royalty_recipient = Address::generate(&env);
    let contract_id = env.register(NftFactory, ());
    (env, admin, royalty_recipient, contract_id)
}

#[test]
fn test_mint_and_get() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    client.initialize(&admin, &royalty_recipient, &500u32);

    let token_id = client.mint(&user, &String::from_str(&env, "ipfs://Qm123"));
    assert_eq!(token_id, 0);

    let nft = client.get_nft(&0u64);
    assert_eq!(nft.owner, user);
    assert_eq!(nft.metadata_uri, String::from_str(&env, "ipfs://Qm123"));
    assert_eq!(client.total_supply(), 1);
}

#[test]
fn test_batch_mint() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);

    client.initialize(&admin, &royalty_recipient, &0u32);

    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);

    let mut recipients = Vec::new(&env);
    recipients.push_back(u1.clone());
    recipients.push_back(u2.clone());
    recipients.push_back(u3.clone());

    let mut uris = Vec::new(&env);
    uris.push_back(String::from_str(&env, "ipfs://A"));
    uris.push_back(String::from_str(&env, "ipfs://B"));
    uris.push_back(String::from_str(&env, "ipfs://C"));

    let ids = client.batch_mint(&recipients, &uris);
    assert_eq!(ids.len(), 3);
    assert_eq!(client.total_supply(), 3);
    assert_eq!(client.get_nft(&0u64).owner, u1);
    assert_eq!(client.get_nft(&1u64).owner, u2);
    assert_eq!(client.get_nft(&2u64).owner, u3);
}

#[test]
fn test_transfer() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let buyer = Address::generate(&env);

    client.initialize(&admin, &royalty_recipient, &250u32);
    client.mint(&user, &String::from_str(&env, "ipfs://X"));
    client.transfer(&user, &buyer, &0u64);

    assert_eq!(client.get_nft(&0u64).owner, buyer);
}

#[test]
fn test_royalty_info() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);

    // 5% royalty
    client.initialize(&admin, &royalty_recipient, &500u32);

    let (recipient, amount) = client.royalty_info(&1000i128);
    assert_eq!(recipient, royalty_recipient);
    assert_eq!(amount, 50); // 5% of 1000
}

#[test]
fn test_set_royalty() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);
    let new_recipient = Address::generate(&env);

    client.initialize(&admin, &royalty_recipient, &500u32);
    client.set_royalty(&new_recipient, &1000u32); // 10%

    let (recipient, amount) = client.royalty_info(&2000i128);
    assert_eq!(recipient, new_recipient);
    assert_eq!(amount, 200); // 10% of 2000
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);
    client.initialize(&admin, &royalty_recipient, &0u32);
    client.initialize(&admin, &royalty_recipient, &0u32);
}

#[test]
#[should_panic(expected = "royalty_bps exceeds 10000")]
fn test_invalid_royalty_bps() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);
    client.initialize(&admin, &royalty_recipient, &10_001u32);
}

#[test]
#[should_panic(expected = "Not the token owner")]
fn test_transfer_not_owner() {
    let (env, admin, royalty_recipient, contract_id) = setup();
    let client = NftFactoryClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let attacker = Address::generate(&env);

    client.initialize(&admin, &royalty_recipient, &0u32);
    client.mint(&user, &String::from_str(&env, "ipfs://Y"));
    client.transfer(&attacker, &attacker, &0u64);
}
