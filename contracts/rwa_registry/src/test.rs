#[cfg(test)]
mod test {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Address, Bytes, Env, String, Vec,
    };

    use crate::{RwaRegistry, RwaRegistryClient};

    fn setup() -> (Env, RwaRegistryClient<'static>, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(RwaRegistry, ());
        let client = RwaRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let user = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        client.initialize(&admin, &signers, &2u32);

        (env, client, admin, signer1, signer2, user)
    }

    fn make_hash(env: &Env, seed: u8) -> Bytes {
        let mut b = Bytes::new(env);
        for _ in 0..32 {
            b.push_back(seed);
        }
        b
    }

    // ── Initialization ────────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let (env, client, _admin, signer1, signer2, _user) = setup();
        let signers = client.get_signers();
        assert_eq!(signers.len(), 2);
        assert!(signers.contains(&signer1));
        assert!(signers.contains(&signer2));
        assert_eq!(client.get_threshold(), 2u32);
        let _ = env;
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_initialize_panics() {
        let (env, client, admin, signer1, _signer2, _user) = setup();
        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        client.initialize(&admin, &signers, &1u32);
    }

    #[test]
    #[should_panic(expected = "Invalid threshold")]
    fn test_invalid_threshold_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RwaRegistry, ());
        let client = RwaRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let signer = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(signer);
        // threshold > signers.len()
        client.initialize(&admin, &signers, &5u32);
    }

    // ── Anchoring ─────────────────────────────────────────────────────────────

    #[test]
    fn test_anchor_and_get() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0xAB);
        let label = String::from_str(&env, "ipfs://QmTest");
        let meta = String::from_str(&env, "initial metadata");

        let doc_id = client.anchor(&user, &hash, &label, &meta);
        assert_eq!(doc_id, 0u64);

        let doc = client.get_doc(&doc_id);
        assert_eq!(doc.hash, hash);
        assert_eq!(doc.label, label);
        assert_eq!(doc.owner, user);
        assert_eq!(doc.metadata, meta);
        assert!(!doc.verified);
    }

    #[test]
    fn test_is_anchored() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0x01);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");

        assert!(!client.is_anchored(&hash));
        client.anchor(&user, &hash, &label, &meta);
        assert!(client.is_anchored(&hash));
    }

    #[test]
    fn test_get_doc_by_hash() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0x02);
        let label = String::from_str(&env, "doc2");
        let meta = String::from_str(&env, "meta2");

        let doc_id = client.anchor(&user, &hash, &label, &meta);
        let doc = client.get_doc_by_hash(&hash);
        assert_eq!(doc.hash, hash);
        let _ = doc_id;
    }

    #[test]
    #[should_panic(expected = "Hash already anchored")]
    fn test_duplicate_hash_panics() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0x03);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        client.anchor(&user, &hash, &label, &meta);
        client.anchor(&user, &hash, &label, &meta);
    }

    #[test]
    #[should_panic(expected = "Hash cannot be empty")]
    fn test_empty_hash_panics() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let empty = Bytes::new(&env);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        client.anchor(&user, &empty, &label, &meta);
    }

    // ── Multi-sig update ──────────────────────────────────────────────────────

    #[test]
    fn test_multisig_update_executes_at_threshold() {
        let (env, client, _admin, signer1, signer2, user) = setup();
        let hash = make_hash(&env, 0x10);
        let label = String::from_str(&env, "rwa-doc");
        let meta = String::from_str(&env, "v1");

        let doc_id = client.anchor(&user, &hash, &label, &meta);

        let new_meta = String::from_str(&env, "v2 updated");
        let proposal_id = client.propose_update(&signer1, &doc_id, &new_meta, &true);

        // First approval – not yet executed.
        client.approve_update(&signer1, &proposal_id);
        let doc = client.get_doc(&doc_id);
        assert_eq!(doc.metadata, meta); // unchanged

        // Second approval – threshold reached, executes.
        client.approve_update(&signer2, &proposal_id);
        let doc = client.get_doc(&doc_id);
        assert_eq!(doc.metadata, new_meta);
        assert!(doc.verified);

        let proposal = client.get_proposal(&proposal_id);
        assert!(proposal.executed);
    }

    #[test]
    #[should_panic(expected = "Not a signer")]
    fn test_non_signer_cannot_propose() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0x20);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        let doc_id = client.anchor(&user, &hash, &label, &meta);
        let new_meta = String::from_str(&env, "hack");
        client.propose_update(&user, &doc_id, &new_meta, &false);
    }

    #[test]
    #[should_panic(expected = "Already approved")]
    fn test_double_approve_panics() {
        let (env, client, _admin, signer1, _s2, user) = setup();
        let hash = make_hash(&env, 0x30);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        let doc_id = client.anchor(&user, &hash, &label, &meta);
        let new_meta = String::from_str(&env, "v2");
        let proposal_id = client.propose_update(&signer1, &doc_id, &new_meta, &false);
        client.approve_update(&signer1, &proposal_id);
        client.approve_update(&signer1, &proposal_id);
    }

    // ── Admin verify ──────────────────────────────────────────────────────────

    #[test]
    fn test_admin_verify() {
        let (env, client, admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0x40);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        let doc_id = client.anchor(&user, &hash, &label, &meta);

        assert!(!client.get_doc(&doc_id).verified);
        client.admin_verify(&admin, &doc_id, &true);
        assert!(client.get_doc(&doc_id).verified);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_non_admin_verify_panics() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        let hash = make_hash(&env, 0x50);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        let doc_id = client.anchor(&user, &hash, &label, &meta);
        client.admin_verify(&user, &doc_id, &true);
    }

    // ── Ledger timestamp ──────────────────────────────────────────────────────

    #[test]
    fn test_anchored_at_timestamp() {
        let (env, client, _admin, _s1, _s2, user) = setup();
        env.ledger().set_timestamp(1_000_000);
        let hash = make_hash(&env, 0x60);
        let label = String::from_str(&env, "doc");
        let meta = String::from_str(&env, "");
        let doc_id = client.anchor(&user, &hash, &label, &meta);
        assert_eq!(client.get_doc(&doc_id).anchored_at, 1_000_000u64);
    }
}
