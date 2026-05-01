#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let governance = Address::generate(&env);
    let contract_id = env.register(ParameterRegistry, ());
    (env, admin, governance, contract_id)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &governance);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_governance(), governance);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &governance);
    client.initialize(&admin, &governance);
}

// ── Governance Transfer ───────────────────────────────────────────────────────

#[test]
fn test_set_governance() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let new_gov = Address::generate(&env);
    client.set_governance(&new_gov);

    assert_eq!(client.get_governance(), new_gov);
}

// ── Parameter CRUD ────────────────────────────────────────────────────────────

#[test]
fn test_set_and_get_param() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let key = Symbol::new(&env, "protocol_fee");
    client.set_param(&key, &30i128); // 30 bps

    assert_eq!(client.get_param(&key), 30i128);
}

#[test]
fn test_update_param() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let key = Symbol::new(&env, "protocol_fee");
    client.set_param(&key, &30i128);
    client.set_param(&key, &50i128);

    assert_eq!(client.get_param(&key), 50i128);
}

#[test]
fn test_has_param() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let key = Symbol::new(&env, "max_slippage");
    assert!(!client.has_param(&key));

    client.set_param(&key, &100i128);
    assert!(client.has_param(&key));
}

#[test]
fn test_get_param_or_default() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let key = Symbol::new(&env, "min_liquidity");
    // Not set — should return default
    assert_eq!(client.get_param_or_default(&key, &1000i128), 1000i128);

    client.set_param(&key, &500i128);
    // Now set — should return stored value
    assert_eq!(client.get_param_or_default(&key, &1000i128), 500i128);
}

#[test]
fn test_remove_param() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let key = Symbol::new(&env, "old_param");
    client.set_param(&key, &42i128);
    assert!(client.has_param(&key));

    client.remove_param(&key);
    assert!(!client.has_param(&key));
}

#[test]
#[should_panic(expected = "Parameter not found")]
fn test_get_missing_param_panics() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    client.get_param(&Symbol::new(&env, "nonexistent"));
}

#[test]
#[should_panic(expected = "Parameter not found")]
fn test_remove_missing_param_panics() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    client.remove_param(&Symbol::new(&env, "ghost"));
}

// ── Multiple Parameters ───────────────────────────────────────────────────────

#[test]
fn test_multiple_independent_params() {
    let (env, admin, governance, contract_id) = setup();
    let client = ParameterRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &governance);

    let fee_key = Symbol::new(&env, "protocol_fee");
    let slippage_key = Symbol::new(&env, "max_slippage");
    let penalty_key = Symbol::new(&env, "unstake_pen");

    client.set_param(&fee_key, &30i128);
    client.set_param(&slippage_key, &200i128);
    client.set_param(&penalty_key, &500i128);

    assert_eq!(client.get_param(&fee_key), 30i128);
    assert_eq!(client.get_param(&slippage_key), 200i128);
    assert_eq!(client.get_param(&penalty_key), 500i128);

    // Remove one, others unaffected
    client.remove_param(&slippage_key);
    assert!(!client.has_param(&slippage_key));
    assert!(client.has_param(&fee_key));
    assert!(client.has_param(&penalty_key));
}
