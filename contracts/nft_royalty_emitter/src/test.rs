#![cfg(test)]
use crate::{NFTRoyaltyEmitter, NFTRoyaltyEmitterClient, RoyaltyRecipient};
use soroban_sdk::{testutils::Address as _, vec, Address, Env};

#[test]
fn test_royalty_settlement_rounding() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let collection = Address::generate(&env);
    let r1 = Address::generate(&env);
    let payer = Address::generate(&env);
    let token = Address::generate(&env);
    let contract_id = env.register(NFTRoyaltyEmitter, ());
    let client = NFTRoyaltyEmitterClient::new(&env, &contract_id);
    client.initialize(&admin);

    // 0.01% (1 BPS) of 100 is 0.01, should round to 0 in i128 math
    client.set_config(
        &admin,
        &collection,
        &vec![
            &env,
            RoyaltyRecipient {
                address: r1.clone(),
                bps: 1,
            },
        ],
    );
    client.settle(&collection, &100, &token, &payer);
}

#[test]
#[should_panic(expected = "Total BPS exceeds 10000")]
fn test_invalid_bps_total() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let collection = Address::generate(&env);
    let contract_id = env.register(NFTRoyaltyEmitter, ());
    let client = NFTRoyaltyEmitterClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.set_config(
        &admin,
        &collection,
        &vec![
            &env,
            RoyaltyRecipient {
                address: admin.clone(),
                bps: 10001,
            },
        ],
    );
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn test_zero_amount_settle() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let collection = Address::generate(&env);
    let contract_id = env.register(NFTRoyaltyEmitter, ());
    let client = NFTRoyaltyEmitterClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.settle(&collection, &0, &Address::generate(&env), &admin);
}
