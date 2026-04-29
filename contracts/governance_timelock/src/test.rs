#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, Symbol};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let contract_id = env.register(GovernanceTimelock, ());
    (env, admin, guardian, contract_id)
}

#[test]
fn test_queue_and_execute_flow() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);
    let delay = 100u64;

    client.initialize(&admin, &guardian, &delay);

    let proposer = Address::generate(&env);
    let desc = Symbol::new(&env, "upgrade_v2");

    let op_id = client.queue_operation(&proposer, &desc);
    assert_eq!(op_id, 1);

    let op = client.get_operation(&op_id);
    assert_eq!(op.status, OperationStatus::Pending);

    // Advance time past delay
    env.ledger().with_mut(|l| l.timestamp = 200);

    client.execute_operation(&op_id);
    let op = client.get_operation(&op_id);
    assert_eq!(op.status, OperationStatus::Executed);
    assert!(!op.is_emergency);
}

#[test]
#[should_panic(expected = "Timelock delay not elapsed")]
fn test_execute_before_delay_panics() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);

    client.initialize(&admin, &guardian, &1000u64);

    let proposer = Address::generate(&env);
    let op_id = client.queue_operation(&proposer, &Symbol::new(&env, "change"));

    // Timestamp is 0, delay is 1000 — should panic
    client.execute_operation(&op_id);
}

#[test]
fn test_pause_blocks_queue_and_execute() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);

    client.initialize(&admin, &guardian, &0u64);
    client.pause();
    assert!(client.is_paused());

    // emergency_resume by guardian restores operation
    client.emergency_resume();
    assert!(!client.is_paused());

    // Now queue should work again
    let proposer = Address::generate(&env);
    let op_id = client.queue_operation(&proposer, &Symbol::new(&env, "fix"));
    assert_eq!(op_id, 1);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_queue_while_paused_panics() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);

    client.initialize(&admin, &guardian, &0u64);
    client.pause();

    let proposer = Address::generate(&env);
    client.queue_operation(&proposer, &Symbol::new(&env, "blocked"));
}

#[test]
fn test_emergency_execute_bypasses_delay() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);

    client.initialize(&admin, &guardian, &9999u64);

    let proposer = Address::generate(&env);
    let op_id = client.queue_operation(&proposer, &Symbol::new(&env, "critical_fix"));

    // Guardian executes immediately without waiting for delay
    client.emergency_execute(&op_id);

    let op = client.get_operation(&op_id);
    assert_eq!(op.status, OperationStatus::Executed);
    assert!(op.is_emergency);
}

#[test]
fn test_cancel_operation() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);

    client.initialize(&admin, &guardian, &500u64);

    let proposer = Address::generate(&env);
    let op_id = client.queue_operation(&proposer, &Symbol::new(&env, "to_cancel"));

    client.cancel_operation(&op_id);
    let op = client.get_operation(&op_id);
    assert_eq!(op.status, OperationStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let (env, admin, guardian, contract_id) = setup();
    let client = GovernanceTimelockClient::new(&env, &contract_id);

    client.initialize(&admin, &guardian, &100u64);
    client.initialize(&admin, &guardian, &100u64);
}
