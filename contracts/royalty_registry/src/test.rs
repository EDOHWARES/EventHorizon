#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{token, vec, Address, Env, IntoVal};

#[test]
fn test_registration_and_update() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);
    let token_addr = Address::generate(&env);

    let contract_id = env.register_contract(None, DeveloperRoyaltyRegistry);
    let client = DeveloperRoyaltyRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &settler, &token_addr);

    let owner = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let splits = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Address(recipient1.clone()),
            bps: 6000,
        },
        RoyaltySplit {
            recipient: Recipient::Address(recipient2.clone()),
            bps: 4000,
        },
    ];

    let service_id = client.register_service(&owner, &100, &splits);
    assert_eq!(service_id, 1);

    let service = client.get_service(&service_id);
    assert_eq!(service.owner, owner);
    assert_eq!(service.fee, 100);
    assert_eq!(service.splits.len(), 2);

    // Update service
    let new_splits = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Address(recipient1.clone()),
            bps: 10000,
        },
    ];
    client.update_service(&service_id, &200, &new_splits);

    let updated_service = client.get_service(&service_id);
    assert_eq!(updated_service.fee, 200);
    assert_eq!(updated_service.splits.len(), 1);
}

#[test]
fn test_simple_settlement() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);
    
    // Setup token
    let token_admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(&env, &token_addr);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);

    let contract_id = env.register_contract(None, DeveloperRoyaltyRegistry);
    let client = DeveloperRoyaltyRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &settler, &token_addr);

    let owner = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let splits = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Address(recipient1.clone()),
            bps: 7000,
        },
        RoyaltySplit {
            recipient: Recipient::Address(recipient2.clone()),
            bps: 3000,
        },
    ];

    let service_id = client.register_service(&owner, &1000, &splits);

    // Give settler some tokens and approve the contract
    token_admin_client.mint(&settler, &5000);
    // Note: In tests with mock_all_auths, we don't strictly need to call approve if we mock auth,
    // but the contract uses transfer_from which requires allowance.
    // However, mock_all_auths handles the requirement for require_auth().
    // For transfer_from, we still need allowance in the real world.
    // In Soroban tests, transfer_from will check allowance.
    
    // Set allowance for the registry contract to spend settler's tokens
    // token_client.approve(&settler, &contract_id, &5000, &env.ledger().sequence() + 100);

    // Settle
    client.settle_royalty(&service_id, &2); // 2000 total

    assert_eq!(token_client.balance(&recipient1), 1400);
    assert_eq!(token_client.balance(&recipient2), 600);
    assert_eq!(token_client.balance(&settler), 3000);
}

#[test]
fn test_hierarchical_settlement() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);
    
    let token_admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(&env, &token_addr);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);

    let contract_id = env.register_contract(None, DeveloperRoyaltyRegistry);
    let client = DeveloperRoyaltyRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &settler, &token_addr);

    let owner = Address::generate(&env);
    
    // Create Sub-Service
    let sub_recipient1 = Address::generate(&env);
    let sub_recipient2 = Address::generate(&env);
    let sub_splits = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Address(sub_recipient1.clone()),
            bps: 5000,
        },
        RoyaltySplit {
            recipient: Recipient::Address(sub_recipient2.clone()),
            bps: 5000,
        },
    ];
    let sub_service_id = client.register_service(&owner, &0, &sub_splits);

    // Create Main Service
    let main_recipient = Address::generate(&env);
    let main_splits = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Address(main_recipient.clone()),
            bps: 2000,
        },
        RoyaltySplit {
            recipient: Recipient::Service(sub_service_id),
            bps: 8000,
        },
    ];
    let main_service_id = client.register_service(&owner, &1000, &main_splits);

    token_admin_client.mint(&settler, &1000);

    // Settle
    client.settle_royalty(&main_service_id, &1);

    // Main recipient: 20% of 1000 = 200
    assert_eq!(token_client.balance(&main_recipient), 200);
    // Sub recipients: 50% each of (80% of 1000) = 400 each
    assert_eq!(token_client.balance(&sub_recipient1), 400);
    assert_eq!(token_client.balance(&sub_recipient2), 400);
}

#[test]
#[should_panic(expected = "Max recursion depth reached")]
fn test_infinite_loop_detection() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);
    let token_addr = Address::generate(&env);

    let contract_id = env.register_contract(None, DeveloperRoyaltyRegistry);
    let client = DeveloperRoyaltyRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &settler, &token_addr);

    let owner = Address::generate(&env);
    
    // Service 1 points to Service 2
    // Service 2 points to Service 1
    
    let splits1 = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Service(2),
            bps: 10000,
        },
    ];
    client.register_service(&owner, &100, &splits1);

    let splits2 = vec![
        &env,
        RoyaltySplit {
            recipient: Recipient::Service(1),
            bps: 10000,
        },
    ];
    client.register_service(&owner, &100, &splits2);

    client.settle_royalty(&1, &1);
}
