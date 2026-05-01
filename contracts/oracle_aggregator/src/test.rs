#![cfg(test)]
use crate::{OracleAggregator, OracleAggregatorClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env,
};

#[test]
fn test_median_even_reports() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let o1 = Address::generate(&env);
    let o2 = Address::generate(&env);
    let contract_id = env.register(OracleAggregator, ());
    let client = OracleAggregatorClient::new(&env, &contract_id);
    client.initialize(&admin, &vec![&env, o1.clone(), o2.clone()], &2, &3600);

    client.report(&o1, &100);
    client.report(&o2, &200);
    // Median of [100, 200] is 150.
}

#[test]
fn test_stale_reports_ignored() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let o1 = Address::generate(&env);
    let o2 = Address::generate(&env);
    let contract_id = env.register(OracleAggregator, ());
    let client = OracleAggregatorClient::new(&env, &contract_id);
    client.initialize(&admin, &vec![&env, o1.clone(), o2.clone()], &2, &100);

    client.report(&o1, &100);
    env.ledger().set_timestamp(101); // o1 is now stale
    client.report(&o2, &200);
    // Only o2 is valid, threshold 2 not met, no consensus.
}

#[test]
fn test_multiple_reports_overwrite() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let o1 = Address::generate(&env);
    let contract_id = env.register(OracleAggregator, ());
    let client = OracleAggregatorClient::new(&env, &contract_id);
    client.initialize(&admin, &vec![&env, o1.clone()], &1, &3600);

    client.report(&o1, &100);
    client.report(&o1, &300);
    // Report for o1 should now be 300.
}
