use soroban_sdk::{
    testutils::{ Address as TestAddress, Ledger as TestLedger },
    Address,
    Bytes,
    Env,
    Vec,
};
use crate::{ ProofStatus, ZkEventFilter };

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkEventFilter);

    env.as_contract(&contract_id, || {
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        ZkEventFilter::initialize(env.clone(), admin.clone(), verifier.clone());

        assert_eq!(ZkEventFilter::get_admin(env.clone()), admin);
        assert_eq!(ZkEventFilter::is_verification_enabled(env.clone()), true);

        let (enabled, trusted_verifier) = ZkEventFilter::get_verification_settings(env.clone());
        assert_eq!(enabled, true);
        assert_eq!(trusted_verifier, verifier);
    });
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_initialize_twice_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    ZkEventFilter::initialize(env.clone(), Address::generate(&env), Address::generate(&env));
}

#[test]
fn test_update_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let new_admin = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin.clone(), verifier);

    ZkEventFilter::update_admin(env.clone(), new_admin.clone());

    assert_eq!(ZkEventFilter::get_admin(env.clone()), new_admin);
}

#[test]
fn test_update_verification_settings() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let new_verifier = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    ZkEventFilter::update_verification_settings(env.clone(), false, new_verifier.clone());

    let (enabled, trusted_verifier) = ZkEventFilter::get_verification_settings(env.clone());
    assert_eq!(enabled, false);
    assert_eq!(trusted_verifier, new_verifier);
}

#[test]
fn test_update_proof_requirements() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    let circuit_hash = Bytes::from_slice(&env, b"new_circuit_hash");
    let verification_key = Bytes::from_slice(&env, b"new_verification_key");

    ZkEventFilter::update_proof_requirements(
        env.clone(),
        circuit_hash.clone(),
        verification_key,
        256,
        20
    );

    let requirements = ZkEventFilter::get_proof_requirements(env.clone());
    assert_eq!(requirements.circuit_hash, circuit_hash);
    assert_eq!(requirements.min_security_level, 256);
    assert_eq!(requirements.max_public_inputs, 20);
}

#[test]
fn test_submit_proof() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    let proof = Bytes::from_slice(&env, b"sample_proof_data");
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(Bytes::from_slice(&env, b"input1"));
    public_inputs.push_back(Bytes::from_slice(&env, b"input2"));

    let proof_id = ZkEventFilter::submit_proof(
        env.clone(),
        submitter.clone(),
        proof.clone(),
        public_inputs.clone(),
        proof_hash.clone()
    );

    assert_eq!(proof_id, 0); // First proof should have ID 0

    let record = ZkEventFilter::get_proof(env.clone(), proof_id);
    assert_eq!(record.id, proof_id);
    assert_eq!(record.submitter, submitter);
    assert_eq!(record.proof_hash, proof_hash);
    assert_eq!(record.status, ProofStatus::Verified); // Should be auto-verified
    assert_eq!(record.verification_result, true);
}

#[test]
#[should_panic(expected = "Too many public inputs")]
fn test_submit_proof_too_many_inputs_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Update requirements to allow only 2 inputs
    let circuit_hash = Bytes::from_slice(&env, b"test_circuit");
    let verification_key = Bytes::from_slice(&env, b"test_key");
    ZkEventFilter::update_proof_requirements(env.clone(), circuit_hash, verification_key, 128, 2);

    let proof = Bytes::from_slice(&env, b"sample_proof");
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(Bytes::from_slice(&env, b"input1"));
    public_inputs.push_back(Bytes::from_slice(&env, b"input2"));
    public_inputs.push_back(Bytes::from_slice(&env, b"input3")); // Too many inputs

    ZkEventFilter::submit_proof(env.clone(), submitter, proof, public_inputs, proof_hash);
}

#[test]
fn test_verify_proof() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier.clone());

    let proof = Bytes::from_slice(&env, b"sample_proof");
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(Bytes::from_slice(&env, b"input1"));

    let proof_id = ZkEventFilter::submit_proof(
        env.clone(),
        submitter,
        proof.clone(),
        public_inputs.clone(),
        proof_hash
    );

    // Verify again (should work as trusted verifier)
    let result = ZkEventFilter::verify_proof(env.clone(), proof_id, proof, public_inputs);
    assert_eq!(result, true);
}

#[test]
fn test_filter_event() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Submit and verify a proof
    let proof = Bytes::from_slice(&env, b"sample_proof");
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(Bytes::from_slice(&env, b"input1"));

    let proof_id = ZkEventFilter::submit_proof(
        env.clone(),
        submitter,
        proof,
        public_inputs,
        proof_hash
    );

    // Test event filtering
    let event_type = Bytes::from_slice(&env, b"event_type_hash");
    let event_data = Bytes::from_slice(&env, b"sample_event_data");

    let filter_result = ZkEventFilter::filter_event(
        env.clone(),
        proof_id,
        event_type.clone(),
        event_data.clone()
    );

    assert_eq!(filter_result, true); // Should pass filter with valid proof
}

#[test]
fn test_filter_event_invalid_proof() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Submit an empty proof (should be rejected)
    let proof = Bytes::new(&env);
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let public_inputs = Vec::new(&env);

    let proof_id = ZkEventFilter::submit_proof(
        env.clone(),
        submitter,
        proof,
        public_inputs,
        proof_hash
    );

    // Test event filtering with invalid proof
    let event_type = Bytes::from_slice(&env, b"event_type_hash");
    let event_data = Bytes::from_slice(&env, b"sample_event_data");

    let filter_result = ZkEventFilter::filter_event(env.clone(), proof_id, event_type, event_data);

    assert_eq!(filter_result, false); // Should fail filter with invalid proof
}

#[test]
fn test_filter_event_expired_proof() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Submit and verify a proof
    let proof = Bytes::from_slice(&env, b"sample_proof");
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(Bytes::from_slice(&env, b"input1"));

    let proof_id = ZkEventFilter::submit_proof(
        env.clone(),
        submitter,
        proof,
        public_inputs,
        proof_hash
    );

    // Advance time beyond proof expiration (24 hours + 1 second)
    env.ledger().set_timestamp(env.ledger().timestamp() + 86401);

    // Test event filtering with expired proof
    let event_type = Bytes::from_slice(&env, b"event_type_hash");
    let event_data = Bytes::from_slice(&env, b"sample_event_data");

    let filter_result = ZkEventFilter::filter_event(env.clone(), proof_id, event_type, event_data);

    assert_eq!(filter_result, false); // Should fail filter with expired proof

    // Check that proof is marked as expired
    let record = ZkEventFilter::get_proof(env.clone(), proof_id);
    assert_eq!(record.status, ProofStatus::Expired);
}

#[test]
#[should_panic(expected = "ZK-proof verification is disabled")]
fn test_disabled_verification_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let submitter = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier.clone());

    // Disable verification
    ZkEventFilter::update_verification_settings(env.clone(), false, verifier);

    let proof = Bytes::from_slice(&env, b"sample_proof");
    let proof_hash = Bytes::from_slice(&env, b"proof_hash");
    let public_inputs = Vec::new(&env);

    ZkEventFilter::submit_proof(env.clone(), submitter, proof, public_inputs, proof_hash);
}

#[test]
#[should_panic(expected = "Security level must be at least 128")]
fn test_proof_requirements_validation() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Test security level too low
    ZkEventFilter::update_proof_requirements(
        env.clone(),
        Bytes::from_slice(&env, b"circuit"),
        Bytes::from_slice(&env, b"key"),
        64, // Too low
        10
    );
}

#[test]
#[should_panic(expected = "Invalid max_public_inputs range")]
fn test_proof_requirements_validation_max_inputs_high() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Test max_public_inputs too high
    ZkEventFilter::update_proof_requirements(
        env.clone(),
        Bytes::from_slice(&env, b"circuit"),
        Bytes::from_slice(&env, b"key"),
        128,
        101 // Too high
    );
}

#[test]
#[should_panic(expected = "Invalid max_public_inputs range")]
fn test_proof_requirements_validation_max_inputs_zero() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    ZkEventFilter::initialize(env.clone(), admin, verifier);

    // Test max_public_inputs zero
    ZkEventFilter::update_proof_requirements(
        env.clone(),
        Bytes::from_slice(&env, b"circuit"),
        Bytes::from_slice(&env, b"key"),
        128,
        0 // Zero not allowed
    );
}
