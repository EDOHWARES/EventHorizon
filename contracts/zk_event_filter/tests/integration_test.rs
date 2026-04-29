use soroban_sdk::{Address, Bytes, Env, Vec};
use zk_event_filter::{ZkEventFilter, ProofStatus};

#[test]
fn test_integration_zk_event_filter() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkEventFilter);
    
    env.as_contract(&contract_id, || {
        // Setup
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);
        let submitter = Address::generate(&env);
        
        ZkEventFilter::initialize(env.clone(), admin.clone(), verifier.clone());
        
        // Test verification settings
        assert_eq!(ZkEventFilter::is_verification_enabled(env.clone()), true);
        let (enabled, trusted_verifier) = ZkEventFilter::get_verification_settings(env.clone());
        assert_eq!(enabled, true);
        assert_eq!(trusted_verifier, verifier);
        
        // Test proof submission
        let proof = Bytes::from_slice(&env, b"integration_test_proof");
        let proof_hash = Bytes::from_slice(&env, b"integration_proof_hash");
        let mut public_inputs = Vec::new(&env);
        public_inputs.push_back(Bytes::from_slice(&env, b"input1"));
        public_inputs.push_back(Bytes::from_slice(&env, b"input2"));
        
        let proof_id = ZkEventFilter::submit_proof(
            env.clone(),
            submitter.clone(),
            proof.clone(),
            public_inputs.clone(),
            proof_hash.clone(),
        );
        
        // Verify proof record
        let record = ZkEventFilter::get_proof(env.clone(), proof_id);
        assert_eq!(record.id, proof_id);
        assert_eq!(record.submitter, submitter);
        assert_eq!(record.proof_hash, proof_hash);
        assert_eq!(record.status, ProofStatus::Verified);
        assert_eq!(record.verification_result, true);
        
        // Test event filtering
        let event_type = Bytes::from_slice(&env, b"test_event_type");
        let event_data = Bytes::from_slice(&env, b"test_event_data");
        let filter_result = ZkEventFilter::filter_event(
            env.clone(),
            proof_id,
            event_type.clone(),
            event_data.clone(),
        );
        
        assert_eq!(filter_result, true);
        
        // Test admin functions
        let new_admin = Address::generate(&env);
        ZkEventFilter::update_admin(env.clone(), new_admin.clone());
        assert_eq!(ZkEventFilter::get_admin(env.clone()), new_admin);
        
        // Test proof requirements update
        let new_circuit_hash = Bytes::from_slice(&env, b"new_circuit");
        let new_verification_key = Bytes::from_slice(&env, b"new_key");
        ZkEventFilter::update_proof_requirements(
            env.clone(),
            new_circuit_hash.clone(),
            new_verification_key,
            256,
            15,
        );
        
        let requirements = ZkEventFilter::get_proof_requirements(env.clone());
        assert_eq!(requirements.circuit_hash, new_circuit_hash);
        assert_eq!(requirements.min_security_level, 256);
        assert_eq!(requirements.max_public_inputs, 15);
    });
}
