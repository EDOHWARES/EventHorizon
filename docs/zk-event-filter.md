# ZK-SNARKs Event Filter

## Overview

The ZK-SNARKs Event Filter is a privacy-preserving smart contract for the EventHorizon platform that enables zero-knowledge proof verification for event filtering without revealing sensitive data.

## Architecture

### Core Components

1. **ZK-Proof Verification Stub**: Implements stub verification logic for ZK-proofs
2. **Event Filtering**: Privacy-preserving event filtering based on verified proofs
3. **Proof Management**: Storage and lifecycle management of ZK-proofs
4. **Admin Controls**: Administrative functions for contract management

### Key Features

- **Privacy-Preserving**: Events can be filtered without revealing underlying data
- **ZK-Proof Verification**: Stub implementation ready for Nova/Plonk integration
- **Event Emission**: Comprehensive event logging for transparency
- **Access Control**: Admin-based permission system
- **Proof Expiration**: Time-based proof validity management

## Contract Interface

### Setup Functions

#### `initialize(admin: Address, trusted_verifier: Address)`
Initializes the contract with admin and trusted verifier addresses.

#### `update_admin(new_admin: Address)`
Updates the admin address (admin only).

#### `update_verification_settings(enabled: bool, trusted_verifier: Address)`
Updates verification settings (admin only).

#### `update_proof_requirements(circuit_hash: Bytes, verification_key: Bytes, min_security_level: u32, max_public_inputs: u32)`
Updates proof requirements (admin only).

### ZK-Proof Functions

#### `submit_proof(submitter: Address, proof: Bytes, public_inputs: Vec<Bytes>, proof_hash: Bytes) -> u64`
Submits a ZK-proof for verification and returns the proof ID.

#### `verify_proof(proof_id: u64, proof: Bytes, public_inputs: Vec<Bytes>) -> bool`
Verifies a ZK-proof (trusted verifier only).

#### `filter_event(proof_id: u64, event_type: Bytes, event_data: Bytes) -> bool`
Filters events based on ZK-proof validity without revealing data.

### View Functions

#### `get_proof(proof_id: u64) -> ProofRecord`
Returns details of a specific proof.

#### `get_admin() -> Address`
Returns the current admin address.

#### `get_verification_settings() -> (bool, Address)`
Returns verification settings.

#### `get_proof_requirements() -> ProofRequirements`
Returns current proof requirements.

#### `is_verification_enabled() -> bool`
Returns whether verification is enabled.

## Data Structures

### ProofRecord
```rust
struct ProofRecord {
    id: u64,
    submitter: Address,
    proof_hash: Bytes,
    public_inputs: Vec<Bytes>,
    verification_result: bool,
    status: ProofStatus,
    submitted_at: u64,
    verified_at: u64,
    gas_used: u64,
}
```

### ProofRequirements
```rust
struct ProofRequirements {
    circuit_hash: Bytes,
    verification_key: Bytes,
    min_security_level: u32,
    max_public_inputs: u32,
}
```

### ProofStatus
```rust
enum ProofStatus {
    Pending = 0,
    Verified = 1,
    Rejected = 2,
    Expired = 3,
}
```

## Events

### ProofSubmitted
Emitted when a ZK-proof is submitted for verification.

### ProofVerified
Emitted when ZK-proof verification is completed.

### EventFiltered
Emitted when privacy-preserving event filtering occurs.

### AdminUpdated
Emitted when admin settings are updated.

### VerificationSettingsUpdated
Emitted when verification settings are updated.

### ProofRequirementsUpdated
Emitted when proof requirements are updated.

## Security Considerations

### Proof Verification
- Currently uses stub implementation
- Prepared for Nova or Plonk integration
- Trusted verifier model for initial deployment

### Privacy Protection
- Event data remains confidential
- Only proof validity is revealed
- Public inputs are limited and controlled

### Access Control
- Admin-only configuration changes
- Trusted verifier for proof verification
- Submitter authentication required

## Future Enhancements

### Nova Integration
- Replace stub verification with Nova ZK-SNARKs
- Add recursive proof composition
- Implement proof aggregation

### Plonk Integration
- Add Plonk proof system support
- Universal setup for multiple circuits
- Improved verification efficiency

### Advanced Features
- Batch proof verification
- Proof composition and recursion
- Cross-chain proof verification

## Usage Example

```rust
// Initialize contract
let admin = Address::generate(&env);
let verifier = Address::generate(&env);
ZkEventFilter::initialize(env.clone(), admin, verifier);

// Submit proof
let proof = Bytes::from_slice(&env, b"zk_proof_data");
let proof_hash = Bytes::from_slice(&env, b"proof_hash");
let mut public_inputs = Vec::new(&env);
public_inputs.push_back(Bytes::from_slice(&env, b"input1"));

let proof_id = ZkEventFilter::submit_proof(
    env.clone(),
    submitter,
    proof,
    public_inputs,
    proof_hash,
);

// Filter event
let event_type = Bytes::from_slice(&env, b"event_type_hash");
let event_data = Bytes::from_slice(&env, b"encrypted_event_data");
let result = ZkEventFilter::filter_event(
    env.clone(),
    proof_id,
    event_type,
    event_data,
);
```

## Performance Notes

- Proof verification is currently stubbed (minimal gas cost)
- Real ZK-proof verification will have significant gas costs
- Event filtering is efficient and privacy-preserving
- Storage costs scale with proof size and public inputs

## Integration Guide

### For EventHorizon Platform
1. Deploy ZK Event Filter contract
2. Configure trusted verifier
3. Set proof requirements for your use case
4. Integrate with existing event systems

### For DApp Developers
1. Generate ZK-proofs off-chain
2. Submit proofs for verification
3. Use verified proofs for private event filtering
4. Listen to contract events for updates

## Testing

The contract includes comprehensive unit tests covering:
- Contract initialization
- Admin functions
- Proof submission and verification
- Event filtering
- Error conditions and edge cases

Run tests with:
```bash
cargo test -p zk_event_filter
```

## License

This contract is part of the EventHorizon platform and follows the same licensing terms.
