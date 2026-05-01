#![cfg(test)]
use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

fn setup() -> (Env, Address, Address, Address, Address, TreasuryGovernanceClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let gov_token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let asset_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let contract_id = env.register(TreasuryGovernance, ());
    let client = TreasuryGovernanceClient::new(&env, &contract_id);

    // quorum = 100, voting_period = 10 ledgers
    client.initialize(&admin, &gov_token_addr, &100i128, &10u32);

    (env, admin, gov_token_addr, asset_addr, contract_id, client)
}

#[test]
fn test_deposit_and_balance() {
    let (env, admin, _gov, asset_addr, contract_id, client) = setup();
    let depositor = Address::generate(&env);

    StellarAssetClient::new(&env, &asset_addr).mint(&depositor, &500);
    client.deposit(&depositor, &asset_addr, &500);

    assert_eq!(client.treasury_balance(&asset_addr), 500);
    assert_eq!(TokenClient::new(&env, &asset_addr).balance(&contract_id), 500);
}

#[test]
fn test_full_governance_flow() {
    let (env, admin, gov_token_addr, asset_addr, contract_id, client) = setup();

    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Mint governance tokens
    let gov_admin = StellarAssetClient::new(&env, &gov_token_addr);
    gov_admin.mint(&voter_a, &150);
    gov_admin.mint(&voter_b, &80);

    // Fund treasury with the spend asset
    StellarAssetClient::new(&env, &asset_addr).mint(&admin, &1000);
    client.deposit(&admin, &asset_addr, &1000);

    // Propose a spend
    let proposal_id = client.propose(
        &voter_a,
        &asset_addr,
        &recipient,
        &200i128,
        &symbol_short!("grant"),
    );
    assert_eq!(proposal_id, 0);
    assert_eq!(client.proposal_count(), 1);

    // Vote
    client.vote(&voter_a, &proposal_id, &true);
    client.vote(&voter_b, &proposal_id, &true);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.votes_for, 230); // 150 + 80
    assert_eq!(proposal.votes_against, 0);
    assert!(client.has_voted(&proposal_id, &voter_a));

    // Advance past voting period
    env.ledger().set_sequence_number(env.ledger().sequence() + 11);

    // Finalize
    client.finalize(&proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Passed);

    // Execute
    client.execute(&proposal_id);
    assert_eq!(TokenClient::new(&env, &asset_addr).balance(&recipient), 200);
    assert_eq!(client.treasury_balance(&asset_addr), 800);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Executed);
}

#[test]
fn test_proposal_rejected_below_quorum() {
    let (env, _admin, gov_token_addr, asset_addr, _contract_id, client) = setup();

    let voter = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Only 50 tokens — below quorum of 100
    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter, &50);
    StellarAssetClient::new(&env, &asset_addr).mint(&voter, &100);
    client.deposit(&voter, &asset_addr, &100);

    let id = client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("req"));
    client.vote(&voter, &id, &true);

    env.ledger().set_sequence_number(env.ledger().sequence() + 11);
    client.finalize(&id);

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Rejected);
}

#[test]
fn test_proposal_rejected_majority_against() {
    let (env, _admin, gov_token_addr, asset_addr, _contract_id, client) = setup();

    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter_a, &120);
    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter_b, &200);
    StellarAssetClient::new(&env, &asset_addr).mint(&voter_a, &500);
    client.deposit(&voter_a, &asset_addr, &500);

    let id = client.propose(&voter_a, &asset_addr, &recipient, &100i128, &symbol_short!("req"));
    client.vote(&voter_a, &id, &true);  // 120 for
    client.vote(&voter_b, &id, &false); // 200 against

    env.ledger().set_sequence_number(env.ledger().sequence() + 11);
    client.finalize(&id);

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Rejected);
}

#[test]
#[should_panic(expected = "Already voted")]
fn test_double_vote_panics() {
    let (env, _admin, gov_token_addr, asset_addr, _contract_id, client) = setup();

    let voter = Address::generate(&env);
    let recipient = Address::generate(&env);

    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter, &200);
    StellarAssetClient::new(&env, &asset_addr).mint(&voter, &100);
    client.deposit(&voter, &asset_addr, &100);

    let id = client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("req"));
    client.vote(&voter, &id, &true);
    client.vote(&voter, &id, &true); // should panic
}

#[test]
#[should_panic(expected = "Proposal not passed")]
fn test_execute_rejected_panics() {
    let (env, _admin, gov_token_addr, asset_addr, _contract_id, client) = setup();

    let voter = Address::generate(&env);
    let recipient = Address::generate(&env);

    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter, &50);
    StellarAssetClient::new(&env, &asset_addr).mint(&voter, &100);
    client.deposit(&voter, &asset_addr, &100);

    let id = client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("req"));
    client.vote(&voter, &id, &true);

    env.ledger().set_sequence_number(env.ledger().sequence() + 11);
    client.finalize(&id); // Rejected (below quorum)
    client.execute(&id);  // Should panic
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let (env, admin, gov_token_addr, _asset, _contract_id, client) = setup();
    client.initialize(&admin, &gov_token_addr, &100i128, &10u32);
}

#[test]
fn test_multi_asset_treasury() {
    let (env, admin, gov_token_addr, asset_a, contract_id, client) = setup();
    let asset_b = env.register_stellar_asset_contract_v2(admin.clone()).address();

    StellarAssetClient::new(&env, &asset_a).mint(&admin, &300);
    StellarAssetClient::new(&env, &asset_b).mint(&admin, &500);

    client.deposit(&admin, &asset_a, &300);
    client.deposit(&admin, &asset_b, &500);

    assert_eq!(client.treasury_balance(&asset_a), 300);
    assert_eq!(client.treasury_balance(&asset_b), 500);
    assert_eq!(TokenClient::new(&env, &asset_a).balance(&contract_id), 300);
    assert_eq!(TokenClient::new(&env, &asset_b).balance(&contract_id), 500);
}

#[test]
fn test_admin_expire_proposal() {
    let (env, admin, gov_token_addr, asset_addr, _contract_id, client) = setup();

    let voter = Address::generate(&env);
    let recipient = Address::generate(&env);

    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter, &200);
    StellarAssetClient::new(&env, &asset_addr).mint(&voter, &100);
    client.deposit(&voter, &asset_addr, &100);

    let id = client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("req"));

    client.expire(&id);
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Expired);
}

#[test]
fn test_list_proposals() {
    let (env, _admin, gov_token_addr, asset_addr, _contract_id, client) = setup();

    let voter = Address::generate(&env);
    let recipient = Address::generate(&env);

    StellarAssetClient::new(&env, &gov_token_addr).mint(&voter, &200);
    StellarAssetClient::new(&env, &asset_addr).mint(&voter, &300);
    client.deposit(&voter, &asset_addr, &300);

    client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("p1"));
    client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("p2"));
    client.propose(&voter, &asset_addr, &recipient, &50i128, &symbol_short!("p3"));

    let ids = client.list_proposals(&3);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0).unwrap(), 0u64);
    assert_eq!(ids.get(2).unwrap(), 2u64);
}
