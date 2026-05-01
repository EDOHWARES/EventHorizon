#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct MerkleProof {
    pub leaf: BytesN<32>,
    pub proof: Vec<(BytesN<32>, bool)>,
}

#[contracttype]
pub enum DataKey {
    BatchCount,
    VerifiedBatch(u64),
}

#[contract]
pub struct BatchMerkleVerifier;

#[contractimpl]
impl BatchMerkleVerifier {
    /// Verify a batch of Merkle proofs against a root.
    /// Emits a success event if all proofs are valid.
    /// Stores the verified batch in the registry.
    pub fn verify_batch(
        env: Env,
        root: BytesN<32>,
        proofs: Vec<MerkleProof>,
    ) -> bool {
        // Verify each proof
        for proof in proofs.iter() {
            if !Self::verify_single_proof(&env, &root, &proof.leaf, &proof.proof) {
                return false;
            }
        }

        // All proofs valid, emit event and store
        let batch_id = Self::get_next_batch_id(&env);
        env.events().publish(
            (symbol_short!("batch_ver"), batch_id),
            (root.clone(), proofs.len() as u32),
        );

        // Store the batch
        let leaves: Vec<BytesN<32>> = proofs.iter().map(|p| p.leaf.clone()).collect();
        env.storage().persistent().set(
            &DataKey::VerifiedBatch(batch_id),
            &(root, leaves),
        );

        true
    }

    /// Get the next batch ID
    fn get_next_batch_id(env: &Env) -> u64 {
        let mut count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BatchCount)
            .unwrap_or(0);
        count += 1;
        env.storage().persistent().set(&DataKey::BatchCount, &count);
        count
    }

    /// Verify a single Merkle proof
    fn verify_single_proof(
        env: &Env,
        root: &BytesN<32>,
        leaf: &BytesN<32>,
        proof: &Vec<(BytesN<32>, bool)>,
    ) -> bool {
        let mut current = leaf.clone();
        for (sibling, is_left) in proof.iter() {
            let mut combined = if *is_left {
                let mut b = soroban_sdk::Bytes::from_slice(env, &sibling.to_array());
                b.append(&soroban_sdk::Bytes::from_slice(env, &current.to_array()));
                b
            } else {
                let mut b = soroban_sdk::Bytes::from_slice(env, &current.to_array());
                b.append(&soroban_sdk::Bytes::from_slice(env, &sibling.to_array()));
                b
            };
            current = env.crypto().sha256(&combined).into();
        }
        current == *root
    }

    /// Get a verified batch by ID
    pub fn get_verified_batch(env: Env, batch_id: u64) -> Option<(BytesN<32>, Vec<BytesN<32>>)> {
        env.storage().persistent().get(&DataKey::VerifiedBatch(batch_id))
    }
}

mod test;