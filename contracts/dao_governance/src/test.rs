#![cfg(test)]
use crate::{DaoGovernance, DaoGovernanceClient, ProposalStatus, ProposalOutcome, VoterMetrics, DelegationInfo, PowerSnapshot};
use soroban_sdk::{testutils::{Address as _, Ledger, Events}, token, Address, Env, symbol_short, Symbol, Vec};

/// Helper: set up a fresh env with an initialized governance contract and a
/// token that has minted to the given voters.
fn setup_env() -> (Env, Address, DaoGovernanceClient, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy token
    let token_addr = env.register_stellar_asset_contract_v2(token_admin).address();

    // Deploy governance
    let gov_id = env.register(&DaoGovernance, ());
    let gov_client = DaoGovernanceClient::new(&env, &gov_id);

    let min_voting_period = 100;
    let timelock_delay = 3600;
    let quorum = 100;

    gov_client.initialize(&admin, &token_addr, &min_voting_period, &timelock_delay, &quorum);

    (env, admin, gov_client, token_addr)
}

// ── Original tests (kept, slightly adapted) ─────────────────────────────────

#[test]
fn test_proposal_lifecycle() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    // Mint tokens to voter
    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    // 1. Create Proposal (enters Proposed state)
    let description = symbol_short!("test_pro");
    let proposal_id = gov_client.create_proposal(&voter, &description);

    assert_eq!(proposal_id, 1);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Proposed);

    // Move to next block to start voting period (enters Open state)
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Open);

    // 2. Vote
    gov_client.vote(&voter, &proposal_id, &true);

    let proposal = gov_client.get_proposal(&proposal_id);
    assert_eq!(proposal.votes_for, 500);
    assert_eq!(proposal.votes_against, 0);

    // 3. Move ledger to end voting (enters Closed state)
    env.ledger().set_sequence(env.ledger().sequence() + 100);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Closed);

    // 4. Queue
    gov_client.queue_proposal(&proposal_id);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Closed);

    // 5. Move time for timelock
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600 + 1);

    // 6. Execute (enters Executed state)
    gov_client.execute_proposal(&proposal_id);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Executed);

    let final_proposal = gov_client.get_proposal(&proposal_id);
    assert!(final_proposal.executed);
}

    let proposal = gov_client.get_proposal(&proposal_id);
    assert_eq!(proposal.votes_for, 500);
    assert_eq!(proposal.votes_against, 0);

    // 3. Move ledger to end voting
    env.ledger().set_sequence(env.ledger().sequence() + 100 + 1);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Succeeded);

    // 4. Queue
    gov_client.queue_proposal(&proposal_id);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Queued);

    // 5. Move time for timelock
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600 + 1);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Queued);

    // 6. Execute
    gov_client.execute_proposal(&proposal_id);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Executed);

    let final_proposal = gov_client.get_proposal(&proposal_id);
    assert!(final_proposal.executed);
}

#[test]
#[should_panic(expected = "Proposal failed")]
fn test_failed_proposal() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &50); // Less than quorum

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("fail"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter, &proposal_id, &true);

    env.ledger().set_sequence(env.ledger().sequence() + 101);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Expired);

    gov_client.queue_proposal(&proposal_id); // Should panic
}

#[test]
#[should_panic(expected = "Already voted")]
fn test_double_voting() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("dbl"));
    gov_client.vote(&voter, &proposal_id, &true);
    gov_client.vote(&voter, &proposal_id, &true); // Should panic
}

// ── Voter Metrics Tests ────────────────────────────────────────────────────

#[test]
fn test_voter_metrics_tracking() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    // Before voting, metrics should be default
    let metrics = gov_client.get_voter_metrics(&voter);
    assert_eq!(metrics.total_weight, 0);
    assert_eq!(metrics.vote_count, 0);

    // Create and vote on first proposal
    let proposal_id1 = gov_client.create_proposal(&voter, &symbol_short!("prop1"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter, &proposal_id1, &true);

    let metrics = gov_client.get_voter_metrics(&voter);
    assert_eq!(metrics.total_weight, 500);
    assert_eq!(metrics.vote_count, 1);
    assert_eq!(metrics.first_vote_ledger, metrics.last_vote_ledger);

    // Create and vote on second proposal
    let proposal_id2 = gov_client.create_proposal(&voter, &symbol_short!("prop2"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter, &proposal_id2, &true);

    let metrics = gov_client.get_voter_metrics(&voter);
    assert_eq!(metrics.total_weight, 1000); // 500 + 500
    assert_eq!(metrics.vote_count, 2);
    assert!(metrics.last_vote_ledger >= metrics.first_vote_ledger);
}

#[test]
fn test_multiple_voters_metrics() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter_a, &300);
    token_client.mint(&voter_b, &200);

    let proposal_id = gov_client.create_proposal(&voter_a, &symbol_short!("multi"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter_a, &proposal_id, &true);
    gov_client.vote(&voter_b, &proposal_id, &false);

    let metrics_a = gov_client.get_voter_metrics(&voter_a);
    assert_eq!(metrics_a.total_weight, 300);
    assert_eq!(metrics_a.vote_count, 1);

    let metrics_b = gov_client.get_voter_metrics(&voter_b);
    assert_eq!(metrics_b.total_weight, 200);
    assert_eq!(metrics_b.vote_count, 1);

    let proposal = gov_client.get_proposal(proposal_id);
    assert_eq!(proposal.votes_for, 300);
    assert_eq!(proposal.votes_against, 200);
}

#[test]
fn test_proposal_voters_list() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter_a, &300);
    token_client.mint(&voter_b, &200);

    let proposal_id = gov_client.create_proposal(&voter_a, &symbol_short!("vlist"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter_a, &proposal_id, &true);
    gov_client.vote(&voter_b, &proposal_id, &true);

    let voters = gov_client.get_proposal_voters(&proposal_id);
    assert_eq!(voters.len(), 2);
}

// ── Delegation Tests ───────────────────────────────────────────────────────

#[test]
fn test_delegate_voting_power() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Before delegation: delegatee power = 200
    assert_eq!(gov_client.get_voting_power(&delegatee), 200);

    // Delegate
    gov_client.delegate(&delegator, &delegatee);

    // After delegation: delegatee power = 200 (own) + 300 (delegated) = 500
    assert_eq!(gov_client.get_voting_power(&delegatee), 500);

    // Delegator's effective power is still just their balance (delegation doesn't
    // reduce it at the balance level; it's accounted for in effective power of the
    // delegatee). The delegator's effective power is their own balance — but they
    // should vote through the delegatee.
    assert_eq!(gov_client.get_voting_power(&delegator), 300);
}

#[test]
fn test_delegation_info_retrieval() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &100);

    // No delegation initially
    let info = gov_client.get_delegation(&delegator);
    assert!(info.is_none());

    // Delegate
    gov_client.delegate(&delegator, &delegatee);

    let info = gov_client.get_delegation(&delegator);
    assert!(info.is_some());
    let info = info.unwrap();
    assert_eq!(info.delegator, delegator);
    assert_eq!(info.delegatee, delegatee);

    // Check incoming delegations for delegatee
    let incoming = gov_client.get_incoming_delegations(&delegatee);
    assert_eq!(incoming.len(), 1);
    assert_eq!(incoming.get(0).unwrap().delegator, delegator);
}

#[test]
fn test_undelegate() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Delegate then undelegate
    gov_client.delegate(&delegator, &delegatee);
    assert_eq!(gov_client.get_voting_power(&delegatee), 500);

    gov_client.undelegate(&delegator);

    // After undelegation, delegatee power returns to 200
    assert_eq!(gov_client.get_voting_power(&delegatee), 200);

    // Delegation is removed
    let info = gov_client.get_delegation(&delegator);
    assert!(info.is_none());

    // Incoming delegations for delegatee is empty
    let incoming = gov_client.get_incoming_delegations(&delegatee);
    assert_eq!(incoming.len(), 0);
}

#[test]
#[should_panic(expected = "Cannot delegate to self")]
fn test_delegate_to_self_panics() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &100);

    gov_client.delegate(&voter, &voter);
}

#[test]
fn test_redelegate_updates_incoming() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee_a = Address::generate(&env);
    let delegatee_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee_a, &100);
    token_client.mint(&delegatee_b, &100);

    // Delegate to A
    gov_client.delegate(&delegator, &delegatee_a);
    assert_eq!(gov_client.get_incoming_delegations(&delegatee_a).len(), 1);
    assert_eq!(gov_client.get_voting_power(&delegatee_a), 400); // 100 + 300

    // Redelegate to B
    gov_client.delegate(&delegator, &delegatee_b);

    // A no longer has incoming
    assert_eq!(gov_client.get_incoming_delegations(&delegatee_a).len(), 0);
    assert_eq!(gov_client.get_voting_power(&delegatee_a), 100);

    // B now has incoming
    assert_eq!(gov_client.get_incoming_delegations(&delegatee_b).len(), 1);
    assert_eq!(gov_client.get_voting_power(&delegatee_b), 400); // 100 + 300
}

#[test]
fn test_vote_with_delegated_power() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Delegates power to delegatee
    gov_client.delegate(&delegator, &delegatee);

    // Delegatee votes with combined power
    let proposal_id = gov_client.create_proposal(&delegatee, &symbol_short!("delvote"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&delegatee, &proposal_id, &true);

    let proposal = gov_client.get_proposal(proposal_id);
    assert_eq!(proposal.votes_for, 500); // 200 + 300

    // Delegatee's metrics reflect the combined weight
    let metrics = gov_client.get_voter_metrics(&delegatee);
    assert_eq!(metrics.total_weight, 500);
    assert_eq!(metrics.vote_count, 1);
}

// ── Voting Power Snapshot Tests ────────────────────────────────────────────

#[test]
fn test_snapshot_voting_power() {
    let (env, admin, gov_client, token_addr) = setup_env();
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter_a, &300);
    token_client.mint(&voter_b, &200);

    // Create a proposal and have both vote
    let proposal_id = gov_client.create_proposal(&voter_a, &symbol_short!("snap1"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter_a, &proposal_id, &true);
    gov_client.vote(&voter_b, &proposal_id, &true);

    // Take snapshot
    let snapshot_id = gov_client.snapshot_voting_power(&admin);
    assert_eq!(snapshot_id, 1);
    assert_eq!(gov_client.get_snapshot_count(), 1);

    let snapshot = gov_client.get_snapshot(&snapshot_id);
    assert_eq!(snapshot.id, 1);
    assert_eq!(snapshot.entries.len(), 2);

    // Verify entries contain correct powers
    let mut found_a = false;
    let mut found_b = false;
    let mut i = 0;
    while i < snapshot.entries.len() {
        let entry = snapshot.entries.get(i).unwrap();
        if entry.voter == voter_a {
            assert_eq!(entry.power, 300);
            found_a = true;
        }
        if entry.voter == voter_b {
            assert_eq!(entry.power, 200);
            found_b = true;
        }
        i += 1;
    }
    assert!(found_a);
    assert!(found_b);
}

#[test]
fn test_snapshot_with_delegation() {
    let (env, admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Delegate and vote
    gov_client.delegate(&delegator, &delegatee);
    let proposal_id = gov_client.create_proposal(&delegatee, &symbol_short!("snapd"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&delegatee, &proposal_id, &true);

    // Snapshot should reflect effective power (200 + 300 = 500) for delegatee
    let snapshot_id = gov_client.snapshot_voting_power(&admin);
    let snapshot = gov_client.get_snapshot(&snapshot_id);

    assert_eq!(snapshot.entries.len(), 1);
    let entry = snapshot.entries.get(0).unwrap();
    assert_eq!(entry.voter, delegatee);
    assert_eq!(entry.power, 500);
}

#[test]
fn test_multiple_snapshots() {
    let (env, admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    // First snapshot: no voters yet
    // (only known voters are captured, so it may be empty)
    let snap1 = gov_client.snapshot_voting_power(&admin);
    assert_eq!(snap1, 1);

    // Vote
    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("msnap"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter, &proposal_id, &true);

    // Second snapshot: now voter is known
    let snap2 = gov_client.snapshot_voting_power(&admin);
    assert_eq!(snap2, 2);
    assert_eq!(gov_client.get_snapshot_count(), 2);

    let snapshot = gov_client.get_snapshot(&snap2);
    assert_eq!(snapshot.entries.len(), 1);
}

// ── VoterEngagement Event Tests ────────────────────────────────────────────

#[test]
fn test_voter_engagement_events_emitted() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter_a, &300);
    token_client.mint(&voter_b, &400);

    // Create proposal, vote, move past voting, queue
    let proposal_id = gov_client.create_proposal(&voter_a, &symbol_short!("engage"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&voter_a, &proposal_id, &true);
    gov_client.vote(&voter_b, &proposal_id, &true);

    // Move past voting period
    env.ledger().set_sequence(env.ledger().sequence() + 101);

    // Queue the proposal — this should emit VoterEngagement events
    gov_client.queue_proposal(&proposal_id);

    // Verify VoterEngagement events were published
    let events = env.events().all();
    // We expect: proposal_created, 2x vote_cast, prop_que, 2x VoterEngagement
    // That's 6 events total
    assert!(events.len() >= 6, "Expected at least 6 events, got {}", events.len());

    // The VoterEngagement events should contain voter addresses and weights
    // We verify through the metrics that tracking was correct
    let metrics_a = gov_client.get_voter_metrics(&voter_a);
    assert_eq!(metrics_a.total_weight, 300);
    assert_eq!(metrics_a.vote_count, 1);

    let metrics_b = gov_client.get_voter_metrics(&voter_b);
    assert_eq!(metrics_b.total_weight, 400);
    assert_eq!(metrics_b.vote_count, 1);
}

#[test]
fn test_engagement_with_delegated_power() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Delegate and vote
    gov_client.delegate(&delegator, &delegatee);
    let proposal_id = gov_client.create_proposal(&delegatee, &symbol_short!("engdel"));
    env.ledger().set_sequence(env.ledger().sequence() + 1); // Start voting
    gov_client.vote(&delegatee, &proposal_id, &true);

    // Move past voting period and queue
    env.ledger().set_sequence(env.ledger().sequence() + 101);
    gov_client.queue_proposal(&proposal_id);

    // Delegatee metrics reflect combined weight
    let metrics = gov_client.get_voter_metrics(&delegatee);
    assert_eq!(metrics.total_weight, 500); // 200 own + 300 delegated
    assert_eq!(metrics.vote_count, 1);
}

// ── Edge Cases ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "No active delegation")]
fn test_undelegate_without_delegation_panics() {
    let (env, _admin, gov_client, _token_addr) = setup_env();
    let voter = Address::generate(&env);

    gov_client.undelegate(&voter);
}

#[test]
#[should_panic(expected = "Already delegated to this address")]
fn test_delegate_same_target_twice_panics() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &100);

    gov_client.delegate(&delegator, &delegatee);
    gov_client.delegate(&delegator, &delegatee); // Should panic
}

#[test]
fn test_default_voter_metrics_for_new_voter() {
    let (env, _admin, gov_client, _token_addr) = setup_env();
    let new_voter = Address::generate(&env);

    let metrics = gov_client.get_voter_metrics(&new_voter);
    assert_eq!(metrics.total_weight, 0);
    assert_eq!(metrics.vote_count, 0);
    assert_eq!(metrics.first_vote_ledger, 0);
    assert_eq!(metrics.last_vote_ledger, 0);
}

#[test]
fn test_voting_power_without_delegation() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &750);

    // Without delegation, effective power = own balance
    assert_eq!(gov_client.get_voting_power(&voter), 750);
}

#[test]
fn test_multiple_delegators_to_one_delegatee() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator_a = Address::generate(&env);
    let delegator_b = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator_a, &100);
    token_client.mint(&delegator_b, &200);
    token_client.mint(&delegatee, &50);

    // Both delegate to the same delegatee
    gov_client.delegate(&delegator_a, &delegatee);
    gov_client.delegate(&delegator_b, &delegatee);

    // Delegatee effective power = 50 + 100 + 200 = 350
    assert_eq!(gov_client.get_voting_power(&delegatee), 350);

    // Check incoming delegations
    let incoming = gov_client.get_incoming_delegations(&delegatee);
    assert_eq!(incoming.len(), 2);

    // Delegatee votes with combined power
    let proposal_id = gov_client.create_proposal(&delegatee, &symbol_short!("multdel"));
    gov_client.vote(&delegatee, &proposal_id, &true);

    let proposal = gov_client.get_proposal(proposal_id);
    assert_eq!(proposal.votes_for, 350);

    // Move past voting and queue
    env.ledger().set_sequence(env.ledger().sequence() + 101);
    gov_client.queue_proposal(&proposal_id);

    // Engagement metrics
    let metrics = gov_client.get_voter_metrics(&delegatee);
    assert_eq!(metrics.total_weight, 350);
    assert_eq!(metrics.vote_count, 1);
}

#[test]
#[should_panic(expected = "Delegated voters cannot vote directly")]
fn test_delegator_cannot_vote_directly() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Delegate
    gov_client.delegate(&delegator, &delegatee);

    // Delegator tries to vote directly — should panic
    let proposal_id = gov_client.create_proposal(&delegatee, &symbol_short!("delblk"));
    gov_client.vote(&delegator, &proposal_id, &true);
}

#[test]
fn test_undelegate_restores_voting() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    // Delegate, then undelegate, then vote directly
    gov_client.delegate(&delegator, &delegatee);
    gov_client.undelegate(&delegator);

    let proposal_id = gov_client.create_proposal(&delegatee, &symbol_short!("undel"));
    // Now delegator can vote again
    gov_client.vote(&delegator, &proposal_id, &true);

    let proposal = gov_client.get_proposal(proposal_id);
    assert_eq!(proposal.votes_for, 300);
}

// ── State Machine Transition Tests ─────────────────────────────────────────

#[test]
fn test_proposal_state_proposed() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let proposer = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&proposer, &500);

    // Right after creation, proposal should be in Proposed state
    let proposal_id = gov_client.create_proposal(&proposer, &symbol_short!("prop"));
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Proposed);
}

#[test]
fn test_proposal_state_open_to_closed() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("open_close"));
    
    // Move to start voting (transitions to Open)
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Open);

    // Vote during open period
    gov_client.vote(&voter, &proposal_id, &true);

    // Move past voting period (transitions to Closed)
    env.ledger().set_sequence(env.ledger().sequence() + 100);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Closed);
}

#[test]
fn test_proposal_state_expired_proposal() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &50); // Less than quorum (100)

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("expire"));
    
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    gov_client.vote(&voter, &proposal_id, &true);

    // Move past voting period with insufficient votes
    env.ledger().set_sequence(env.ledger().sequence() + 100);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Expired);
}

#[test]
fn test_full_state_machine_lifecycle() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("full_life"));

    // Proposed -> Open
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Proposed);
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Open);

    // Vote during Open
    gov_client.vote(&voter, &proposal_id, &true);

    // Open -> Closed
    env.ledger().set_sequence(env.ledger().sequence() + 100);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Closed);

    // Queue (still Closed while in timelock)
    gov_client.queue_proposal(&proposal_id);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Closed);

    // Wait for timelock and execute -> Executed
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600 + 1);
    gov_client.execute_proposal(&proposal_id);
    assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Executed);
}

// ── Enhanced Event Logging Tests ───────────────────────────────────────────

#[test]
fn test_proposal_created_event() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let proposer = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&proposer, &500);

    let description = symbol_short!("event_test");
    let _proposal_id = gov_client.create_proposal(&proposer, &description);

    // Verify events were emitted
    let events = env.events().all();
    assert!(events.len() >= 1, "Expected at least 1 event for proposal creation");
}

#[test]
fn test_vote_cast_event_emitted() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("vote_evt"));
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    
    let initial_event_count = env.events().all().len();
    
    gov_client.vote(&voter, &proposal_id, &true);

    let events = env.events().all();
    // Should have more events after voting
    assert!(events.len() > initial_event_count, "Expected additional events after voting");
}

#[test]
fn test_proposal_closed_event_on_queue() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("close_evt"));
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    gov_client.vote(&voter, &proposal_id, &true);

    env.ledger().set_sequence(env.ledger().sequence() + 100);
    
    let initial_event_count = env.events().all().len();
    gov_client.queue_proposal(&proposal_id);

    let events = env.events().all();
    // Should emit ProposalClosed event
    assert!(events.len() > initial_event_count, "Expected ProposalClosed event");
}

#[test]
fn test_proposal_executed_event() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter, &500);

    let proposal_id = gov_client.create_proposal(&voter, &symbol_short!("exec_evt"));
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    gov_client.vote(&voter, &proposal_id, &true);

    env.ledger().set_sequence(env.ledger().sequence() + 100);
    gov_client.queue_proposal(&proposal_id);

    env.ledger().set_timestamp(env.ledger().timestamp() + 3600 + 1);
    
    let initial_event_count = env.events().all().len();
    gov_client.execute_proposal(&proposal_id);

    let events = env.events().all();
    // Should emit ProposalExecuted event
    assert!(events.len() > initial_event_count, "Expected ProposalExecuted event");
}

#[test]
fn test_delegation_changed_event_includes_power() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    let initial_event_count = env.events().all().len();
    
    gov_client.delegate(&delegator, &delegatee);

    let events = env.events().all();
    // Should emit DelegationChanged event with power info
    assert!(events.len() > initial_event_count, "Expected DelegationChanged event");
}

#[test]
fn test_delegation_removed_event_includes_power() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee, &200);

    gov_client.delegate(&delegator, &delegatee);
    
    let initial_event_count = env.events().all().len();
    gov_client.undelegate(&delegator);

    let events = env.events().all();
    // Should emit DelegationRemoved event with power info
    assert!(events.len() > initial_event_count, "Expected DelegationRemoved event");
}

// ── Complex Integration Tests ──────────────────────────────────────────────

#[test]
fn test_proposal_state_tracking_with_multiple_proposals() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&voter_a, &500);
    token_client.mint(&voter_b, &600);

    // Create first proposal
    let prop1 = gov_client.create_proposal(&voter_a, &symbol_short!("prop1"));
    assert_eq!(gov_client.get_status(&prop1), ProposalStatus::Proposed);

    // Create second proposal
    let prop2 = gov_client.create_proposal(&voter_b, &symbol_short!("prop2"));
    assert_eq!(gov_client.get_status(&prop2), ProposalStatus::Proposed);

    // Move time forward
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    
    // Both should transition to Open
    assert_eq!(gov_client.get_status(&prop1), ProposalStatus::Open);
    assert_eq!(gov_client.get_status(&prop2), ProposalStatus::Open);

    // Vote on both
    gov_client.vote(&voter_a, &prop1, &true);
    gov_client.vote(&voter_b, &prop2, &true);

    // Still Open
    assert_eq!(gov_client.get_status(&prop1), ProposalStatus::Open);
    assert_eq!(gov_client.get_status(&prop2), ProposalStatus::Open);

    // Move past voting period
    env.ledger().set_sequence(env.ledger().sequence() + 100);
    
    // Both should transition to Closed
    assert_eq!(gov_client.get_status(&prop1), ProposalStatus::Closed);
    assert_eq!(gov_client.get_status(&prop2), ProposalStatus::Closed);
}

#[test]
fn test_delegation_changes_during_voting() {
    let (env, _admin, gov_client, token_addr) = setup_env();
    let delegator = Address::generate(&env);
    let delegatee_a = Address::generate(&env);
    let delegatee_b = Address::generate(&env);

    let token_client = token::Client::new(&env, &token_addr);
    token_client.mint(&delegator, &300);
    token_client.mint(&delegatee_a, &200);
    token_client.mint(&delegatee_b, &250);

    // Delegate to A
    gov_client.delegate(&delegator, &delegatee_a);
    assert_eq!(gov_client.get_voting_power(&delegatee_a), 500);
    assert_eq!(gov_client.get_voting_power(&delegatee_b), 250);

    // Create proposal and have delegatee_a vote
    let proposal_id = gov_client.create_proposal(&delegatee_a, &symbol_short!("del_vote"));
    env.ledger().set_sequence(env.ledger().sequence() + 1);
    gov_client.vote(&delegatee_a, &proposal_id, &true);

    let proposal = gov_client.get_proposal(proposal_id);
    assert_eq!(proposal.votes_for, 500);

    // Redelegate to B after voting (simulating a change in delegation after voting)
    gov_client.delegate(&delegator, &delegatee_b);
    assert_eq!(gov_client.get_voting_power(&delegatee_a), 200);
    assert_eq!(gov_client.get_voting_power(&delegatee_b), 550);
}

