#![cfg(test)]

use crate::{RecoveryRequest, SocialRecovery, SocialRecoveryClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, Vec,
};

const DELAY: u64 = 3_600;

fn setup() -> (Env, SocialRecoveryClient<'static>, Address, Vec<Address>) {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let guardians = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let contract_id = env.register(SocialRecovery, ());
    let client = SocialRecoveryClient::new(&env, &contract_id);
    client.initialize(&owner, &guardians, &2u32, &DELAY);

    (env, client, owner, guardians)
}

#[test]
fn test_recovery_lifecycle() {
    let (env, client, owner, guardians) = setup();
    let nominee = Address::generate(&env);

    let request_id = client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    let request: RecoveryRequest = client.get_active_recovery().unwrap();
    assert_eq!(request_id, 1);
    assert_eq!(request.approvals, 1);
    assert_eq!(request.ready_at, None);
    assert!(client.has_voted(&guardians.get(0).unwrap()));

    client.vote_recovery(&guardians.get(1).unwrap());
    let ready = client.get_active_recovery().unwrap();
    assert_eq!(ready.approvals, 2);
    assert_eq!(ready.ready_at, Some(env.ledger().timestamp() + DELAY));

    assert!(client.try_execute_recovery(&nominee).is_err());

    env.ledger().set_timestamp(env.ledger().timestamp() + DELAY);
    client.execute_recovery(&nominee);

    assert_eq!(client.get_owner(), nominee);
    assert!(client.get_active_recovery().is_none());
    assert_ne!(client.get_owner(), owner);
}

#[test]
fn test_revoke_vote_resets_timelock() {
    let (env, client, _owner, guardians) = setup();
    let nominee = Address::generate(&env);

    client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    client.vote_recovery(&guardians.get(1).unwrap());
    let first_ready_at = client.get_active_recovery().unwrap().ready_at.unwrap();

    client.revoke_vote(&guardians.get(1).unwrap());
    let after_revoke = client.get_active_recovery().unwrap();
    assert_eq!(after_revoke.approvals, 1);
    assert_eq!(after_revoke.ready_at, None);

    env.ledger().set_timestamp(first_ready_at + 1);
    assert!(client.try_execute_recovery(&nominee).is_err());

    client.vote_recovery(&guardians.get(2).unwrap());
    let rescheduled = client.get_active_recovery().unwrap();
    assert_eq!(rescheduled.approvals, 2);
    assert_eq!(rescheduled.ready_at, Some(env.ledger().timestamp() + DELAY));
}

#[test]
fn test_owner_can_cancel_recovery() {
    let (env, client, owner, guardians) = setup();
    let nominee = Address::generate(&env);

    client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    client.cancel_recovery(&owner);

    assert!(client.get_active_recovery().is_none());
    assert_eq!(client.get_owner(), owner);
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_guardian_can_cancel_recovery() {
    let (env, client, owner, guardians) = setup();
    let nominee = Address::generate(&env);

    client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    client.cancel_recovery(&guardians.get(1).unwrap());

    assert!(client.get_active_recovery().is_none());
    assert_eq!(client.get_owner(), owner);
}

#[test]
#[should_panic(expected = "Not a guardian")]
fn test_non_guardian_cannot_request_recovery() {
    let (env, client, _owner, _guardians) = setup();
    let outsider = Address::generate(&env);
    let nominee = Address::generate(&env);

    client.request_recovery(&outsider, &nominee);
}

#[test]
fn test_duplicate_vote_rejected() {
    let (env, client, _owner, guardians) = setup();
    let nominee = Address::generate(&env);

    client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    assert!(client.try_vote_recovery(&guardians.get(0).unwrap()).is_err());
}

#[test]
fn test_wrong_nominee_cannot_execute() {
    let (env, client, _owner, guardians) = setup();
    let nominee = Address::generate(&env);
    let attacker = Address::generate(&env);

    client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    client.vote_recovery(&guardians.get(1).unwrap());
    env.ledger().set_timestamp(env.ledger().timestamp() + DELAY);

    assert!(client.try_execute_recovery(&attacker).is_err());
    assert_ne!(client.get_owner(), attacker);
}

#[test]
fn test_recovery_execution_consumes_budget() {
    let (env, client, _owner, guardians) = setup();
    let nominee = Address::generate(&env);

    client.request_recovery(&guardians.get(0).unwrap(), &nominee);
    client.vote_recovery(&guardians.get(1).unwrap());
    env.ledger().set_timestamp(env.ledger().timestamp() + DELAY);
    client.execute_recovery(&nominee);

    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(cpu > 0, "CPU instructions should be non-zero after recovery execution");
}
