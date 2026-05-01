# Batch Merkle Proof Verifier

The `BatchMerkleVerifier` contract provides gas-efficient verification of multiple Merkle proofs against a single root hash. It serves as a registry for verified batches, emitting events for successful verifications to support L2-style anchoring.

## Features

- **Batch Verification**: Verifies multiple Merkle proofs in a single transaction for gas efficiency.
- **Registry Storage**: Stores verified batches with their root hashes and leaf data.
- **Event Emission**: Publishes events upon successful batch verification for L2 anchoring.
- **Optimized for Large Batches**: Designed to handle large numbers of proofs efficiently.

## Contract Interface

### `verify_batch(root: BytesN<32>, proofs: Vec<MerkleProof>) -> bool`
Verifies a batch of Merkle proofs against the provided root.
- Returns `true` if all proofs are valid, `false` otherwise.
- Emits a `batch_verified` event with the batch ID, root, and proof count.
- Stores the verified batch in the registry.

### `get_verified_batch(batch_id: u64) -> Option<(BytesN<32>, Vec<BytesN<32>>)>`
Retrieves a verified batch by its ID, returning the root and list of leaves if found.

## Data Structures

### `MerkleProof`
```rust
struct MerkleProof {
    leaf: BytesN<32>,
    proof: Vec<(BytesN<32>, bool)>,
}
```
- `leaf`: The hash of the leaf to verify.
- `proof`: A list of (sibling_hash, is_left) pairs, where `is_left` indicates if the sibling is on the left side of the tree.

## Usage Example

To verify a batch of proofs:

1. Construct `MerkleProof` structs for each leaf.
2. Call `verify_batch` with the Merkle root and vector of proofs.
3. Check the return value and listen for the emitted event.

## Security Considerations

- Proofs are verified using SHA-256 hashing as per standard Merkle tree construction.
- The contract assumes proofs are correctly formatted; invalid proofs will fail verification.
- Storage of large batches may incur significant gas costs; consider batch size limits.