#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Events}, Address, Env, IntoVal, symbol_short, String};

#[test]
fn test_init_intent() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CrossChainBridge);
    let client = CrossChainBridgeClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let target_network = symbol_short!("ETH");
    let target_address = String::from_str(&env, "0x1234567890abcdef");
    let hash = BytesN::from_array(&env, &[0u8; 32]);

    client.init_intent(&user, &target_network, &target_address, &hash);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event,
        (
            contract_id.clone(),
            (symbol_short!("INTENT"), user.clone(), target_network.clone()).into_val(&env),
            CrossChainIntent {
                target_network,
                target_address,
                hash,
            }.into_val(&env)
        )
    );
}

#[test]
fn test_relay_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CrossChainBridge);
    let client = CrossChainBridgeClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    
    // Set relayer
    client.set_relayer(&admin, &relayer, &true);
    assert!(client.is_relayer(&relayer));

    let target_network = symbol_short!("SOL");
    let target_address = String::from_str(&env, "7xkx...sol");
    let hash = BytesN::from_array(&env, &[1u8; 32]);

    client.relay(&relayer, &target_network, &target_address, &hash);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event,
        (
            contract_id.clone(),
            (symbol_short!("RELAY"), relayer.clone(), target_network.clone()).into_val(&env),
            CrossChainIntent {
                target_network,
                target_address,
                hash,
            }.into_val(&env)
        )
    );
}

#[test]
#[should_panic(expected = "Unauthorized relayer")]
fn test_relay_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CrossChainBridge);
    let client = CrossChainBridgeClient::new(&env, &contract_id);

    let relayer = Address::generate(&env);
    let target_network = symbol_short!("ETH");
    let target_address = String::from_str(&env, "0x...");
    let hash = BytesN::from_array(&env, &[0u8; 32]);

    // Should panic because relayer is not authorized
    client.relay(&relayer, &target_network, &target_address, &hash);
}

#[test]
#[should_panic(expected = "Not authorized admin")]
fn test_admin_restriction() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CrossChainBridge);
    let client = CrossChainBridgeClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let relayer = Address::generate(&env);

    // admin1 sets up
    client.set_relayer(&admin1, &relayer, &true);

    // admin2 tries to change it - should panic
    client.set_relayer(&admin2, &relayer, &false);
}
