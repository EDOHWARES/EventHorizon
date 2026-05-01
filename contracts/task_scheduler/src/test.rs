#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Bytes, Env};

fn setup() -> (Env, Address, TaskSchedulerClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    // Start at a non-zero timestamp so "future" checks work
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let owner = Address::generate(&env);
    let contract_id = env.register(TaskScheduler, ());
    let client = TaskSchedulerClient::new(&env, &contract_id);
    (env, owner, client)
}

#[test]
fn test_schedule_and_get() {
    let (env, owner, client) = setup();
    let payload = Bytes::from_slice(&env, b"run_job_42");

    let id = client.schedule(&owner, &2000, &payload);
    assert_eq!(id, 0);

    let task = client.get_task(&id);
    assert_eq!(task.id, 0);
    assert_eq!(task.owner, owner);
    assert_eq!(task.trigger_at, 2000);
    assert_eq!(task.payload, payload);
    assert_eq!(task.status, TaskStatus::Pending);
}

#[test]
fn test_schedule_increments_id() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    let id0 = client.schedule(&owner, &2000, &p);
    let id1 = client.schedule(&owner, &3000, &p);
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
}

#[test]
fn test_get_owner_tasks() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    client.schedule(&owner, &2000, &p);
    client.schedule(&owner, &3000, &p);

    let ids = client.get_owner_tasks(&owner);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids.get(0).unwrap(), 0);
    assert_eq!(ids.get(1).unwrap(), 1);
}

#[test]
fn test_bump_updates_trigger_at() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    let id = client.schedule(&owner, &2000, &p);

    client.bump(&owner, &id, &5000);

    let task = client.get_task(&id);
    assert_eq!(task.trigger_at, 5000);
    assert_eq!(task.status, TaskStatus::Pending);
}

#[test]
fn test_cancel_marks_cancelled() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    let id = client.schedule(&owner, &2000, &p);

    client.cancel(&owner, &id);

    let task = client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Task is not pending")]
fn test_bump_cancelled_task_panics() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    let id = client.schedule(&owner, &2000, &p);
    client.cancel(&owner, &id);
    client.bump(&owner, &id, &5000);
}

#[test]
#[should_panic(expected = "Task is not pending")]
fn test_cancel_already_cancelled_panics() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    let id = client.schedule(&owner, &2000, &p);
    client.cancel(&owner, &id);
    client.cancel(&owner, &id);
}

#[test]
#[should_panic(expected = "trigger_at must be in the future")]
fn test_schedule_past_trigger_panics() {
    let (env, owner, client) = setup();
    let p = Bytes::from_slice(&env, b"x");
    // timestamp is 1000, scheduling at 500 should panic
    client.schedule(&owner, &500, &p);
}

#[test]
#[should_panic(expected = "Not task owner")]
fn test_cancel_by_non_owner_panics() {
    let (env, owner, client) = setup();
    let other = Address::generate(&env);
    let p = Bytes::from_slice(&env, b"x");
    let id = client.schedule(&owner, &2000, &p);
    client.cancel(&other, &id);
}

#[test]
#[should_panic(expected = "Not task owner")]
fn test_bump_by_non_owner_panics() {
    let (env, owner, client) = setup();
    let other = Address::generate(&env);
    let p = Bytes::from_slice(&env, b"x");
    let id = client.schedule(&owner, &2000, &p);
    client.bump(&other, &id, &5000);
}
