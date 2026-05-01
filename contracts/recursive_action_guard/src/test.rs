#![cfg(test)]
use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

fn setup(max_depth: u32) -> (Env, Address, RecursiveActionGuardClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RecursiveActionGuard, ());
    let client = RecursiveActionGuardClient::new(&env, &contract_id);
    client.initialize(&admin, &max_depth);
    (env, admin, client)
}

#[test]
fn test_enter_and_exit() {
    let (env, _, client) = setup(3);
    let caller = Address::generate(&env);
    let action = symbol_short!("transfer");

    assert_eq!(client.get_depth(&caller, &action), 0);

    let d1 = client.enter(&caller, &action);
    assert_eq!(d1, 1);
    assert_eq!(client.get_depth(&caller, &action), 1);

    let d2 = client.enter(&caller, &action);
    assert_eq!(d2, 2);

    let e1 = client.exit(&caller, &action);
    assert_eq!(e1, 1);

    let e2 = client.exit(&caller, &action);
    assert_eq!(e2, 0);
    assert_eq!(client.get_depth(&caller, &action), 0);
}

#[test]
#[should_panic(expected = "Recursive loop detected")]
fn test_blocks_at_max_depth() {
    let (env, _, client) = setup(2);
    let caller = Address::generate(&env);
    let action = symbol_short!("swap");

    client.enter(&caller, &action); // depth 1
    client.enter(&caller, &action); // depth 2 — at max
    client.enter(&caller, &action); // should panic
}

#[test]
fn test_independent_callers() {
    let (env, _, client) = setup(2);
    let caller_a = Address::generate(&env);
    let caller_b = Address::generate(&env);
    let action = symbol_short!("mint");

    client.enter(&caller_a, &action);
    client.enter(&caller_a, &action); // caller_a at max

    // caller_b is independent — should not be blocked
    let d = client.enter(&caller_b, &action);
    assert_eq!(d, 1);
}

#[test]
fn test_independent_actions() {
    let (env, _, client) = setup(2);
    let caller = Address::generate(&env);
    let action_a = symbol_short!("mint");
    let action_b = symbol_short!("burn");

    client.enter(&caller, &action_a);
    client.enter(&caller, &action_a); // action_a at max

    // action_b is independent — should not be blocked
    let d = client.enter(&caller, &action_b);
    assert_eq!(d, 1);
}

#[test]
#[should_panic(expected = "No active entry to exit")]
fn test_exit_without_enter_panics() {
    let (env, _, client) = setup(3);
    let caller = Address::generate(&env);
    client.exit(&caller, &symbol_short!("noop"));
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let (_, admin, client) = setup(3);
    client.initialize(&admin, &3);
}

#[test]
fn test_admin_set_max_depth() {
    let (_, admin, client) = setup(3);
    assert_eq!(client.get_max_depth(), 3);
    client.set_max_depth(&4);
    assert_eq!(client.get_max_depth(), 4);
}

#[test]
fn test_depth_resets_after_full_exit() {
    let (env, _, client) = setup(3);
    let caller = Address::generate(&env);
    let action = symbol_short!("relay");

    client.enter(&caller, &action);
    client.enter(&caller, &action);
    client.exit(&caller, &action);
    client.exit(&caller, &action);

    // After full exit, should be able to enter again up to max
    let d = client.enter(&caller, &action);
    assert_eq!(d, 1);
}
