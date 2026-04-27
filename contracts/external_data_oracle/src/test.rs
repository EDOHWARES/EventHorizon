#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String, Symbol,
};

fn sym(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

#[test]
fn numeric_feed_median_validation() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let admin = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);

    let contract_id = env.register_contract(None, ExternalDataOracle);
    let client = ExternalDataOracleClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.add_source(&admin, &s1);
    client.add_source(&admin, &s2);
    client.add_source(&admin, &s3);

    let feed = sym(&env, "lagos_tmp");
    client.register_numeric_feed(&admin, &feed, &3u32, &3600u64, &None);

    assert_eq!(client.submit_numeric(&s1, &feed, &25i128, &900u64), None);
    assert_eq!(client.submit_numeric(&s2, &feed, &30i128, &950u64), None);
    let validated = client
        .submit_numeric(&s3, &feed, &28i128, &999u64)
        .unwrap();

    assert_eq!(validated.value, ValidatedValue::Numeric(28));
    assert_eq!(validated.sources_used, 3);
    assert_eq!(client.get_validated(&feed).unwrap(), validated);
}

#[test]
fn logistics_feed_quorum_validation() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 2_000);

    let admin = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);

    let contract_id = env.register_contract(None, ExternalDataOracle);
    let client = ExternalDataOracleClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.add_source(&admin, &s1);
    client.add_source(&admin, &s2);
    client.add_source(&admin, &s3);

    let feed = sym(&env, "ship_evt");
    client.register_logistics_feed(&admin, &feed, &2u32, &10_000u64);

    let e1 = LogisticsEvent {
        shipment_id: String::from_str(&env, "SHP-001"),
        event_type: sym(&env, "arrival"),
        status: sym(&env, "ok"),
        location: Some(String::from_str(&env, "LOS")),
        eta: None,
    };
    let e2 = e1.clone();
    let e3 = LogisticsEvent {
        shipment_id: String::from_str(&env, "SHP-001"),
        event_type: sym(&env, "arrival"),
        status: sym(&env, "delayed"),
        location: Some(String::from_str(&env, "LOS")),
        eta: Some(2_500),
    };

    assert_eq!(client.submit_logistics(&s1, &feed, &e1, &1990u64), None);
    let validated = client
        .submit_logistics(&s2, &feed, &e2, &1995u64)
        .unwrap();

    assert_eq!(validated.value, ValidatedValue::Logistics(e1.clone()));
    assert_eq!(validated.sources_used, 2);

    // Third source submits a different event; majority stays same.
    let validated2 = client.validate_feed(&feed).unwrap();
    assert_eq!(validated2.value, ValidatedValue::Logistics(e1));

    // Make submissions stale and ensure validation fails.
    env.ledger().with_mut(|li| li.timestamp = 20_000);
    assert_eq!(client.submit_logistics(&s3, &feed, &e3, &2_000u64), None);
}

