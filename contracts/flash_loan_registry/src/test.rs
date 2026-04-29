#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _};

#[test]
fn test_registry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry_id = env.register(FlashLoanRegistry, ());
    let client = FlashLoanRegistryClient::new(&env, &registry_id);

    client.init(&admin);

    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    let token = Address::generate(&env);
    let amount = 1000000i128;
    let profit = 10000i128; // 1% ROI

    client.record_loan(&provider, &borrower, &token, &amount, &profit);

    let (total_loans, total_profit) = client.get_stats();
    assert_eq!(total_loans, 1);
    assert_eq!(total_profit, 10000);

    // Record another loan
    client.record_loan(&provider, &borrower, &token, &amount, &0);
    let (total_loans, total_profit) = client.get_stats();
    assert_eq!(total_loans, 2);
    assert_eq!(total_profit, 10000); // profit didn't increase
}
