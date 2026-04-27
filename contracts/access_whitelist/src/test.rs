#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (Address, Address) {
    let super_admin = Address::generate(env);
    let contract_id = env.register(AccessWhitelist, ());
    let client = AccessWhitelistClient::new(env, &contract_id);
    client.initialize(&super_admin);
    (contract_id, super_admin)
}

#[test]
fn test_grant_and_check_access() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let user = Address::generate(&env);

    // SuperAdmin grants User level
    client.grant(&super_admin, &user, &PermissionLevel::User);
    assert!(client.has_access(&user, &PermissionLevel::User));
    assert!(!client.has_access(&user, &PermissionLevel::Operator));

    let level = client.get_permission(&user);
    assert_eq!(level, PermissionLevel::User);
}

#[test]
fn test_hierarchical_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let user = Address::generate(&env);

    // SuperAdmin -> Admin
    client.grant(&super_admin, &admin, &PermissionLevel::Admin);
    // Admin -> Operator
    client.grant(&admin, &operator, &PermissionLevel::Operator);
    // Operator -> User
    client.grant(&operator, &user, &PermissionLevel::User);

    assert_eq!(client.get_permission(&admin), PermissionLevel::Admin);
    assert_eq!(client.get_permission(&operator), PermissionLevel::Operator);
    assert_eq!(client.get_permission(&user), PermissionLevel::User);
}

#[test]
#[should_panic(expected = "Insufficient permission level")]
fn test_cannot_grant_equal_or_higher_level() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.grant(&super_admin, &admin, &PermissionLevel::Admin);

    let other = Address::generate(&env);
    // Admin tries to grant Admin (equal) — should panic
    client.grant(&admin, &other, &PermissionLevel::Admin);
}

#[test]
fn test_revoke_access() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    client.grant(&super_admin, &user, &PermissionLevel::User);
    assert!(client.has_access(&user, &PermissionLevel::User));

    client.revoke(&super_admin, &user);
    assert!(!client.has_access(&user, &PermissionLevel::User));
    assert_eq!(client.get_permission(&user), PermissionLevel::None);
}

#[test]
fn test_renounce() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let operator = Address::generate(&env);
    client.grant(&super_admin, &operator, &PermissionLevel::Operator);

    client.renounce(&operator);
    assert_eq!(client.get_permission(&operator), PermissionLevel::None);
}

#[test]
fn test_transfer_super_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let new_admin = Address::generate(&env);
    client.transfer_super_admin(&super_admin, &new_admin);

    assert_eq!(client.get_permission(&new_admin), PermissionLevel::SuperAdmin);
    assert_eq!(client.get_permission(&super_admin), PermissionLevel::None);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);
    client.initialize(&super_admin);
}

#[test]
#[should_panic(expected = "Insufficient permission level")]
fn test_user_cannot_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, super_admin) = setup(&env);
    let client = AccessWhitelistClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let other = Address::generate(&env);
    client.grant(&super_admin, &user, &PermissionLevel::User);

    // User tries to grant User to someone else — should panic
    client.grant(&user, &other, &PermissionLevel::User);
}
