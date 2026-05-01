#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Events;
use soroban_sdk::{BytesN, Env, Vec};

#[test]
fn test_verify_single_proof() {
    let env = Env::default();
    let contract_id = env.register(BatchMerkleVerifier, ());
    let client = BatchMerkleVerifierClient::new(&env, &contract_id);

    // Simple Merkle tree: root = hash(hash(leaf1) + hash(leaf2))
    // But for single leaf, proof is empty? Wait, for single leaf, root = hash(leaf)
    // But typically Merkle has at least two leaves.

    // Let's create a simple tree.
    // Leaves: A, B
    // Root: hash(hash(A) + hash(B))

    let leaf_a = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, b"A"));
    let leaf_b = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, b"B"));

    let mut combined = soroban_sdk::Bytes::from_slice(&env, &leaf_a.to_array());
    combined.append(&soroban_sdk::Bytes::from_slice(&env, &leaf_b.to_array()));
    let root = env.crypto().sha256(&combined);

    // Proof for A: (hash(B), false) since A is left, B is right? Wait.
    // In standard Merkle, if A left, B right, hash(A+B)
    // Proof for A: (B, false) meaning current = A, sibling = B, since right, hash(A + B)

    let proof_a: Vec<(BytesN<32>, bool)> = Vec::new(&env);
    proof_a.push((leaf_b, false));

    // But wait, the proof should be hash of siblings, not the leaf hash.
    // Mistake: the proof contains the hash of the sibling, not the leaf.

    // For leaf A, proof: (hash(B), false)

    // Yes.

    // But in code, leaf is hash(A), proof has hash(B)

    // Yes.

    // So, to verify, start with hash(A), then hash(hash(A) + hash(B)) == root

    // Yes.

    // For batch, let's say two proofs.

    let mut proofs: Vec<MerkleProof> = Vec::new(&env);

    let proof1 = MerkleProof {
        leaf: leaf_a,
        proof: {
            let mut p = Vec::new(&env);
            p.push((leaf_b, false));
            p
        },
    };

    let proof2 = MerkleProof {
        leaf: leaf_b,
        proof: {
            let mut p = Vec::new(&env);
            p.push((leaf_a, true)); // for B, since B is right, sibling A is left, so is_left = true
            p
        },
    };

    proofs.push(proof1);
    proofs.push(proof2);

    let result = client.verify_batch(&root, &proofs);
    assert!(result);

    // Check event
    let events = env.events().all();
    assert_eq!(events.len(), 1);
    // Check storage
    let batch = client.get_verified_batch(&1);
    assert!(batch.is_some());
}

#[test]
fn test_invalid_proof() {
    let env = Env::default();
    let contract_id = env.register(BatchMerkleVerifier, ());
    let client = BatchMerkleVerifierClient::new(&env, &contract_id);

    let leaf_a = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, b"A"));
    let leaf_b = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, b"B"));
    let leaf_c = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, b"C"));

    let mut combined = soroban_sdk::Bytes::from_slice(&env, &leaf_a.to_array());
    combined.append(&soroban_sdk::Bytes::from_slice(&env, &leaf_b.to_array()));
    let root = env.crypto().sha256(&combined);

    let mut proofs: Vec<MerkleProof> = Vec::new(&env);
    let proof1 = MerkleProof {
        leaf: leaf_c, // invalid leaf
        proof: {
            let mut p = Vec::new(&env);
            p.push((leaf_b, false));
            p
        },
    };
    proofs.push(proof1);

    let result = client.verify_batch(&root, &proofs);
    assert!(!result);
}

#[test]
fn test_large_batch() {
    let env = Env::default();
    let contract_id = env.register(BatchMerkleVerifier, ());
    let client = BatchMerkleVerifierClient::new(&env, &contract_id);

    // Create a larger tree for benchmarking
    // Simple case: 4 leaves
    let leaves = vec!["A", "B", "C", "D"];
    let hashed_leaves: Vec<BytesN<32>> = leaves
        .iter()
        .map(|s| env.crypto().sha256(&soroban_sdk::Bytes::from_slice(&env, s.as_bytes())))
        .collect();

    // Build tree
    let h01 = {
        let mut b = soroban_sdk::Bytes::from_slice(&env, &hashed_leaves[0].to_array());
        b.append(&soroban_sdk::Bytes::from_slice(&env, &hashed_leaves[1].to_array()));
        env.crypto().sha256(&b)
    };
    let h23 = {
        let mut b = soroban_sdk::Bytes::from_slice(&env, &hashed_leaves[2].to_array());
        b.append(&soroban_sdk::Bytes::from_slice(&env, &hashed_leaves[3].to_array()));
        env.crypto().sha256(&b)
    };
    let root = {
        let mut b = soroban_sdk::Bytes::from_slice(&env, &h01.to_array());
        b.append(&soroban_sdk::Bytes::from_slice(&env, &h23.to_array()));
        env.crypto().sha256(&b)
    };

    // Proofs
    let mut proofs: Vec<MerkleProof> = Vec::new(&env);

    // Proof for A: siblings: hash(B), hash(C+D)
    let proof_a = MerkleProof {
        leaf: hashed_leaves[0],
        proof: {
            let mut p = Vec::new(&env);
            p.push((hashed_leaves[1], false)); // right sibling
            p.push((h23, false)); // right
            p
        },
    };

    proofs.push(proof_a);

    let result = client.verify_batch(&root, &proofs);
    assert!(result);
}