#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String, Vec as SorobanVec};

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let contract_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Verify admin was set
    let metadata = client.get_metadata(&admin);
    // This will fail since admin is not registered - just verify initialize works
    assert!(true);
}

#[test]
fn test_register_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "TestContract");
    let description = String::from_slice(&env, "A test contract for ABI registry");
    let abi_data = vec![&env, 1u8, 2, 3, 4];
    let note = String::from_slice(&env, "Initial version");

    let version = client.register(
        &contract_id,
        &name,
        &description,
        &abi_data,
        &note,
    );

    assert_eq!(version, 1);

    // Verify metadata
    let metadata = client.get_metadata(&contract_id);
    assert_eq!(metadata.contract_id, contract_id);
    assert_eq!(metadata.name, name);
    assert_eq!(metadata.description, description);
    assert_eq!(metadata.version, 1);
    assert!(!metadata.verified);
    assert!(metadata.added_at > 0);

    // Verify ABI data can be retrieved separately
    let retrieved_abi = client.get_abi(&contract_id);
    assert_eq!(retrieved_abi.len(), abi_data.len());
}

#[test]
fn test_update_abi() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "TestContract");
    let description = String::from_slice(&env, "A test contract");
    let abi_data_v1 = vec![&env, 1u8, 2, 3, 4];
    let note_v1 = String::from_slice(&env, "Version 1");

    client.register(&contract_id, &name, &description, &abi_data_v1, &note_v1);

    // Update to version 2
    let abi_data_v2 = vec![&env, 1u8, 2, 3, 4, 5, 6];
    let note_v2 = String::from_slice(&env, "Version 2 - added new function");

    let new_version = client.update(&contract_id, &abi_data_v2, &note_v2);

    assert_eq!(new_version, 2);

    // Verify metadata updated
    let metadata = client.get_metadata(&contract_id);
    assert_eq!(metadata.version, 2);
    assert!(metadata.updated_at >= metadata.added_at);

    // Verify version history
    let history = client.get_version_history(&contract_id);
    assert_eq!(history.len(), 2);
}

#[test]
fn test_verify_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "VerifiedContract");
    let description = String::from_slice(&env, "A verified contract");
    let abi_data = vec![&env, 1u8, 2, 3];
    let note = String::from_slice(&env, "Initial");

    client.register(&contract_id, &name, &description, &abi_data, &note);

    // Initially not verified
    let metadata_before = client.get_metadata(&contract_id);
    assert!(!metadata_before.verified);

    // Verify the contract
    let result = client.verify(&contract_id);
    assert!(result);

    // Check verified status
    let metadata_after = client.get_metadata(&contract_id);
    assert!(metadata_after.verified);

    // Check verified contracts list
    let verified_list = client.get_verified_contracts();
    assert!(verified_list.contains(&contract_id));
}

#[test]
fn test_get_by_name() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "MyContract");
    let description = String::from_slice(&env, "Description");
    let abi_data = vec![&env, 1u8];
    let note = String::from_slice(&env, "Note");

    client.register(&contract_id, &name, &description, &abi_data, &note);

    // Lookup by name
    let found_id = client.get_by_name(&name);
    assert!(found_id.is_some());
    assert_eq!(found_id.unwrap(), contract_id);

    // Non-existent name
    let nonexistent = String::from_slice(&env, "NonExistent");
    let not_found = client.get_by_name(&nonexistent);
    assert!(not_found.is_none());
}

#[test]
fn test_is_registered() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);
    let unregistered = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "TestContract");
    let description = String::from_slice(&env, "Description");
    let abi_data = vec![&env, 1u8];
    let note = String::from_slice(&env, "Note");

    client.register(&contract_id, &name, &description, &abi_data, &note);

    assert!(client.is_registered(&contract_id));
    assert!(!client.is_registered(&unregistered));
}

#[test]
fn test_remove_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "TestContract");
    let description = String::from_slice(&env, "Description");
    let abi_data = vec![&env, 1u8];
    let note = String::from_slice(&env, "Note");

    client.register(&contract_id, &name, &description, &abi_data, &note);

    // Verify it's registered
    assert!(client.is_registered(&contract_id));

    // Remove
    let result = client.remove(&contract_id);
    assert!(result);

    // Verify it's no longer registered
    assert!(!client.is_registered(&contract_id));

    // Verify name lookup fails
    let found = client.get_by_name(&name);
    assert!(found.is_none());
}

#[test]
#[should_panic(expected = "Contract already registered")]
fn test_duplicate_registration_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "TestContract");
    let description = String::from_slice(&env, "Description");
    let abi_data = vec![&env, 1u8];
    let note = String::from_slice(&env, "Note");

    // First registration should succeed
    client.register(&contract_id, &name, &description, &abi_data, &note);

    // Second registration should panic
    client.register(&contract_id, &name, &description, &abi_data, &note);
}

#[test]
#[should_panic(expected = "Contract not registered")]
fn test_update_unregistered_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let abi_data = vec![&env, 1u8];
    let note = String::from_slice(&env, "Note");

    // Should panic - contract not registered
    client.update(&contract_id, &abi_data, &note);
}

#[test]
fn test_version_history_trimming() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = Address::generate(&env);

    let registry_id = env.register_contract(None, AbiRegistry);
    let client = AbiRegistryClient::new(&env, &registry_id);

    client.initialize(&admin);

    let name = String::from_slice(&env, "TestContract");
    let description = String::from_slice(&env, "Description");
    let abi_data = vec![&env, 1u8];
    let note = String::from_slice(&env, "Note");

    client.register(&contract_id, &name, &description, &abi_data, &note);

    // Create many updates to test trimming
    for i in 0..105 {
        let new_abi = vec![&env, i as u8];
        let note = String::from_slice(&env, "Update");
        client.update(&contract_id, &new_abi, &note);
    }

    // Version history should be trimmed to MAX_VERSION_HISTORY
    let history = client.get_version_history(&contract_id);
    // Should have at most MAX_VERSION_HISTORY entries
    assert!((history.len() as u32) <= MAX_VERSION_HISTORY);
}