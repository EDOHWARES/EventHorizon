#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, BytesN, vec};

#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        // In a real contract, this would call update_current_contract_wasm
        // For testing, we just emit an event to verify it was called
        env.events().publish((symbol_short!("Target"), symbol_short!("Upgraded")), new_wasm_hash);
    }
}

#[test]
fn test_upgrade_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let target = env.register_contract(None, MockTarget);
    
    let manager_id = env.register_contract(None, UpgradeManager);
    let client = UpgradeManagerClient::new(&env, &manager_id);

    let guardians = vec![&env, guardian.clone()];
    client.initialize(&admin, &guardians);

    let new_wasm_hash = BytesN::from_array(&env, &[1; 32]);

    // Propose upgrade
    client.propose_upgrade(&admin, &target, &new_wasm_hash);

    let proposal = client.get_upgrade(&target).unwrap();
    assert_eq!(proposal.new_wasm_hash, new_wasm_hash);
    assert_eq!(proposal.frozen, false);
    assert_eq!(proposal.eta, env.ledger().timestamp() + 172_800);

    // Try to finalize too early
    let result = client.try_finalize_upgrade(&target);
    assert!(result.is_err());

    // Advance time by 48 hours
    env.ledger().set_timestamp(env.ledger().timestamp() + 172_800);

    // Finalize upgrade
    client.finalize_upgrade(&target);

    // Verify it's removed from storage
    assert!(client.get_upgrade(&target).is_none());
}

#[test]
fn test_emergency_freeze() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let target = env.register_contract(None, MockTarget);
    
    let manager_id = env.register_contract(None, UpgradeManager);
    let client = UpgradeManagerClient::new(&env, &manager_id);

    client.initialize(&admin, &vec![&env, guardian.clone()]);

    let new_wasm_hash = BytesN::from_array(&env, &[2; 32]);
    client.propose_upgrade(&admin, &target, &new_wasm_hash);

    // Freeze by guardian
    client.freeze_upgrade(&guardian, &target);
    
    let proposal = client.get_upgrade(&target).unwrap();
    assert!(proposal.frozen);

    // Advance time by 48 hours
    env.ledger().set_timestamp(env.ledger().timestamp() + 172_800);

    // Finalize should fail because frozen
    let result = client.try_finalize_upgrade(&target);
    assert!(result.is_err());

    // Unfreeze by admin
    client.unfreeze_upgrade(&target);
    assert!(!client.get_upgrade(&target).unwrap().frozen);

    // Now it should work
    client.finalize_upgrade(&target);
}

#[test]
fn test_cancel_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let target = Address::generate(&env);
    
    let manager_id = env.register_contract(None, UpgradeManager);
    let client = UpgradeManagerClient::new(&env, &manager_id);

    client.initialize(&admin, &vec![&env]);

    let new_wasm_hash = BytesN::from_array(&env, &[3; 32]);
    client.propose_upgrade(&admin, &target, &new_wasm_hash);

    assert!(client.get_upgrade(&target).is_some());

    // Cancel by admin
    client.cancel_upgrade(&target);
    assert!(client.get_upgrade(&target).is_none());
}

#[test]
#[should_panic(expected = "Only admin can propose upgrades")]
fn test_unauthorized_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let target = Address::generate(&env);
    
    let manager_id = env.register_contract(None, UpgradeManager);
    let client = UpgradeManagerClient::new(&env, &manager_id);

    client.initialize(&admin, &vec![&env]);

    let new_wasm_hash = BytesN::from_array(&env, &[4; 32]);
    client.propose_upgrade(&user, &target, &new_wasm_hash);
}

#[test]
#[should_panic(expected = "Not a guardian")]
fn test_unauthorized_freeze() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let user = Address::generate(&env);
    let target = Address::generate(&env);
    
    let manager_id = env.register_contract(None, UpgradeManager);
    let client = UpgradeManagerClient::new(&env, &manager_id);

    client.initialize(&admin, &vec![&env, guardian.clone()]);

    let new_wasm_hash = BytesN::from_array(&env, &[5; 32]);
    client.propose_upgrade(&admin, &target, &new_wasm_hash);

    client.freeze_upgrade(&user, &target);
}
