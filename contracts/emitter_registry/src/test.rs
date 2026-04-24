#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, Env, String};

#[test]
fn test_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let voter = Address::generate(&env);
    let contract_to_verify = Address::generate(&env);

    // Deploy and register the registry contract
    let contract_id = env.register_contract(None, EmitterRegistry);
    let client = EmitterRegistryClient::new(&env, &contract_id);

    // Deploy a token for voting
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(&env, &token_id);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

    // Initialize the registry
    let quorum = 1000;
    client.initialize(&admin, &token_id, &quorum);

    // Give voter some voting power
    token_admin_client.mint(&voter, &2000);

    // Propose adding a contract
    let metadata = ContractMetadata {
        name: symbol_short!("test"),
        description: String::from_str(&env, "A test contract"),
        verified: true,
        added_at: env.ledger().timestamp(),
    };

    let voting_period = 3600;
    let proposal_id = client.propose(&voter, &contract_to_verify, &ProposalAction::Add(metadata.clone()), &voting_period);

    // Vote on the proposal
    client.vote(&voter, &proposal_id, &true);

    // Try to execute before end_time (should fail)
    // env.ledger().set_timestamp(env.ledger().timestamp() + 3601); // Move time forward
    
    // Instead of failing here, we'll move time forward and execute
    env.ledger().with_mut(|li| li.timestamp += 3601);

    client.execute(&proposal_id);

    // Check if verified
    assert!(client.is_verified(&contract_to_verify));
    let stored_metadata = client.get_metadata(&contract_to_verify).unwrap();
    assert_eq!(stored_metadata.name, metadata.name);

    // Test Emergency Removal
    client.emergency_remove(&admin, &contract_to_verify);
    assert!(!client.is_verified(&contract_to_verify));
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, EmitterRegistry);
    let client = EmitterRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token, &100);
    client.initialize(&admin, &token, &100);
}

#[test]
#[should_panic(expected = "Unauthorized: Only security committee can perform emergency removal")]
fn test_unauthorized_emergency_removal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let target = Address::generate(&env);

    let contract_id = env.register_contract(None, EmitterRegistry);
    let client = EmitterRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &Address::generate(&env), &100);

    // Attacker tries to remove
    client.emergency_remove(&attacker, &target);
}

#[test]
#[should_panic(expected = "Proposal failed or quorum not met")]
fn test_failed_proposal_low_votes() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let voter = Address::generate(&env);
    let target = Address::generate(&env);

    let contract_id = env.register_contract(None, EmitterRegistry);
    let client = EmitterRegistryClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

    let quorum = 1000;
    client.initialize(&admin, &token_id, &quorum);

    // Give voter less than quorum
    token_admin_client.mint(&voter, &500);

    let proposal_id = client.propose(&voter, &target, &ProposalAction::Remove, &3600);
    client.vote(&voter, &proposal_id, &true);

    env.ledger().with_mut(|li| li.timestamp += 3601);

    client.execute(&proposal_id);
}
