#[cfg(test)]
mod test {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String,
    };

    use crate::{DaoWhitelist, DaoWhitelistClient, ProposalAction};

    const QUORUM: i128 = 100;
    const VOTING_PERIOD: u64 = 3600; // 1 hour

    fn setup() -> (
        Env,
        DaoWhitelistClient<'static>,
        Address, // admin
        Address, // voter1
        Address, // voter2
        Address, // target contract
    ) {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy a Stellar asset as the governance token.
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_contract.address();
        let token_sac = StellarAssetClient::new(&env, &token_id);

        let voter1 = Address::generate(&env);
        let voter2 = Address::generate(&env);
        // Mint voting power.
        token_sac.mint(&voter1, &500i128);
        token_sac.mint(&voter2, &300i128);

        let admin = Address::generate(&env);
        let target = Address::generate(&env);

        let contract_id = env.register(DaoWhitelist, ());
        let client = DaoWhitelistClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &QUORUM, &VOTING_PERIOD);

        (env, client, admin, voter1, voter2, target)
    }

    // ── Initialization ────────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let (_env, _client, _admin, _v1, _v2, _target) = setup();
        // If setup() completes without panic, initialization succeeded.
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_initialize_panics() {
        let (env, client, admin, voter1, _v2, _target) = setup();
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_id = token_contract.address();
        client.initialize(&admin, &token_id, &QUORUM, &VOTING_PERIOD);
        let _ = voter1;
    }

    // ── Proposal lifecycle ────────────────────────────────────────────────────

    #[test]
    fn test_propose_and_vote_and_execute_add() {
        let (env, client, _admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "high-priority DEX");

        // Propose addition.
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label.clone()));
        assert_eq!(proposal_id, 1u64);
        assert_eq!(client.get_proposal_count(), 1u64);

        // Both voters vote FOR.
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);

        // Advance time past voting period.
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);

        assert!(!client.is_whitelisted(&target));
        client.execute(&proposal_id);
        assert!(client.is_whitelisted(&target));

        let entry = client.get_entry(&target);
        assert_eq!(entry.label, label);
        assert_eq!(entry.priority, 1u32);
    }

    #[test]
    fn test_propose_and_execute_remove() {
        let (env, client, admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "contract to remove");

        // First add the contract via governance.
        let add_id = client.propose(&voter1, &target, &ProposalAction::Add(label.clone()));
        client.vote(&voter1, &add_id, &true);
        client.vote(&voter2, &add_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&add_id);
        assert!(client.is_whitelisted(&target));

        // Now propose removal.
        env.ledger().set_timestamp(env.ledger().timestamp() + 1);
        let rem_id = client.propose(&voter1, &target, &ProposalAction::Remove);
        client.vote(&voter1, &rem_id, &true);
        client.vote(&voter2, &rem_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&rem_id);
        assert!(!client.is_whitelisted(&target));
        let _ = admin;
    }

    #[test]
    #[should_panic(expected = "Proposal failed")]
    fn test_proposal_fails_below_quorum() {
        let (env, client, _admin, voter1, _voter2, target) = setup();
        let label = String::from_str(&env, "low-vote contract");

        // voter1 has 500 tokens but quorum is 100; however votes_against >= votes_for
        // We'll test the case where nobody votes (votes_for = 0 < quorum).
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        // No votes cast.
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);
    }

    #[test]
    #[should_panic(expected = "Proposal failed")]
    fn test_proposal_fails_more_against_than_for() {
        let (env, client, _admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "contested contract");

        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        // voter1 (500) votes FOR, voter2 (300) votes AGAINST → FOR > AGAINST but
        // let's flip: voter1 votes AGAINST, voter2 votes FOR.
        client.vote(&voter1, &proposal_id, &false); // 500 against
        client.vote(&voter2, &proposal_id, &true);  // 300 for
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);
    }

    #[test]
    #[should_panic(expected = "Already voted")]
    fn test_double_vote_panics() {
        let (env, client, _admin, voter1, _v2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter1, &proposal_id, &true);
    }

    #[test]
    #[should_panic(expected = "Voting period ended")]
    fn test_vote_after_period_panics() {
        let (env, client, _admin, voter1, _v2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.vote(&voter1, &proposal_id, &true);
    }

    #[test]
    #[should_panic(expected = "Voting period not ended")]
    fn test_execute_before_period_ends_panics() {
        let (env, client, _admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);
        // Do NOT advance time.
        client.execute(&proposal_id);
    }

    #[test]
    #[should_panic(expected = "Already executed")]
    fn test_double_execute_panics() {
        let (env, client, _admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);
        client.execute(&proposal_id);
    }

    // ── Admin operations ──────────────────────────────────────────────────────

    #[test]
    fn test_set_priority() {
        let (env, client, admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "priority contract");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);

        assert_eq!(client.get_entry(&target).priority, 1u32);
        client.set_priority(&admin, &target, &5u32);
        assert_eq!(client.get_entry(&target).priority, 5u32);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_non_admin_set_priority_panics() {
        let (env, client, _admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);
        client.set_priority(&voter1, &target, &10u32);
    }

    #[test]
    fn test_emergency_remove() {
        let (env, client, admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);
        assert!(client.is_whitelisted(&target));

        client.emergency_remove(&admin, &target);
        assert!(!client.is_whitelisted(&target));
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_non_admin_emergency_remove_panics() {
        let (env, client, _admin, voter1, voter2, target) = setup();
        let label = String::from_str(&env, "doc");
        let proposal_id = client.propose(&voter1, &target, &ProposalAction::Add(label));
        client.vote(&voter1, &proposal_id, &true);
        client.vote(&voter2, &proposal_id, &true);
        env.ledger().set_timestamp(env.ledger().timestamp() + VOTING_PERIOD + 1);
        client.execute(&proposal_id);
        client.emergency_remove(&voter1, &target);
    }
}
