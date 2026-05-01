# Requirements Document

## Introduction

The Periodic Reward Distribution and Dividend Ledger contract enables gas-efficient distribution of rewards to multiple addresses using a pull-based or Merkle tree approach. This contract supports configurable distribution weights, anti-gaming mechanisms through snapshots, and comprehensive event tracking for transparency and auditability.

## Glossary

- **Reward_Distribution_Contract**: The Soroban smart contract that manages periodic reward distributions
- **Epoch**: A discrete time period during which rewards are accumulated and made available for claiming
- **Merkle_Root**: The cryptographic root hash of a Merkle tree representing all claimable rewards for an epoch
- **Claim_Proof**: A Merkle proof that validates an address's eligibility to claim a specific reward amount
- **Distribution_Weight**: A numerical value representing the proportional share of rewards allocated to an address
- **Snapshot**: A point-in-time capture of distribution weights used to prevent gaming through weight manipulation
- **Claimant**: An address eligible to claim rewards from the distribution
- **Administrator**: An authorized address with permission to manage epochs and distribution parameters

## Requirements

### Requirement 1: Epoch Management

**User Story:** As an administrator, I want to start new reward epochs, so that rewards can be distributed periodically to eligible claimants.

#### Acceptance Criteria

1. WHEN an administrator initiates a new epoch, THE Reward_Distribution_Contract SHALL create a new Epoch with a unique identifier
2. WHEN a new Epoch is created, THE Reward_Distribution_Contract SHALL emit an EpochStarted event containing the epoch identifier and timestamp
3. WHEN an Epoch is started, THE Reward_Distribution_Contract SHALL capture a Snapshot of current Distribution_Weights
4. THE Reward_Distribution_Contract SHALL prevent starting a new Epoch while the previous Epoch is still active
5. WHEN an Epoch is finalized, THE Reward_Distribution_Contract SHALL store the Merkle_Root for that Epoch

### Requirement 2: Merkle-Based Reward Claims

**User Story:** As a claimant, I want to claim my rewards using a Merkle proof, so that I can receive my allocated rewards in a gas-efficient manner.

#### Acceptance Criteria

1. WHEN a Claimant submits a valid Claim_Proof for an Epoch, THE Reward_Distribution_Contract SHALL verify the proof against the stored Merkle_Root
2. WHEN a Claim_Proof is verified successfully, THE Reward_Distribution_Contract SHALL transfer the reward amount to the Claimant
3. WHEN a reward is claimed, THE Reward_Distribution_Contract SHALL emit a Claimed event containing the claimant address, epoch identifier, and claimed amount
4. THE Reward_Distribution_Contract SHALL prevent double-claiming by recording claimed rewards per Claimant per Epoch
5. IF a Claim_Proof verification fails, THEN THE Reward_Distribution_Contract SHALL revert the transaction with a descriptive error message
6. IF a Claimant attempts to claim already-claimed rewards, THEN THE Reward_Distribution_Contract SHALL revert the transaction

### Requirement 3: Distribution Weight Management

**User Story:** As an administrator, I want to update distribution weights for addresses, so that reward allocations reflect current participation or stake levels.

#### Acceptance Criteria

1. WHEN an administrator updates Distribution_Weights, THE Reward_Distribution_Contract SHALL store the new weight values
2. THE Reward_Distribution_Contract SHALL allow weight updates only between Epochs
3. WHEN Distribution_Weights are updated, THE Reward_Distribution_Contract SHALL validate that total weights do not exceed maximum allowed values
4. THE Reward_Distribution_Contract SHALL support setting weights for multiple addresses in a single transaction
5. WHEN weights are modified, THE Reward_Distribution_Contract SHALL emit events indicating the addresses and new weight values

### Requirement 4: Anti-Gaming Snapshot Mechanism

**User Story:** As a system designer, I want to use snapshots of distribution weights, so that claimants cannot manipulate their allocations after an epoch begins.

#### Acceptance Criteria

1. WHEN an Epoch starts, THE Reward_Distribution_Contract SHALL create a Snapshot of all Distribution_Weights at that block timestamp
2. THE Reward_Distribution_Contract SHALL use the Snapshot weights for calculating reward allocations for that Epoch
3. THE Reward_Distribution_Contract SHALL ignore any weight changes made after the Snapshot is captured for the current Epoch
4. THE Reward_Distribution_Contract SHALL store Snapshots immutably for each Epoch
5. WHEN calculating rewards, THE Reward_Distribution_Contract SHALL reference only the Snapshot associated with the specific Epoch

### Requirement 5: Reward Calculation and Allocation

**User Story:** As a claimant, I want my reward amount to be calculated proportionally based on my distribution weight, so that I receive a fair share of the total rewards.

#### Acceptance Criteria

1. WHEN rewards are allocated for an Epoch, THE Reward_Distribution_Contract SHALL calculate each Claimant's share proportional to their Distribution_Weight in the Snapshot
2. THE Reward_Distribution_Contract SHALL ensure the sum of all allocated rewards equals the total reward pool for the Epoch
3. THE Reward_Distribution_Contract SHALL handle rounding errors by allocating remainder amounts according to a deterministic rule
4. WHEN a Claimant has zero Distribution_Weight in the Snapshot, THE Reward_Distribution_Contract SHALL allocate zero rewards to that address
5. THE Reward_Distribution_Contract SHALL support reward pools denominated in the native token or specified token types

### Requirement 6: Access Control and Authorization

**User Story:** As a system owner, I want to restrict administrative functions to authorized addresses, so that the contract remains secure and tamper-proof.

#### Acceptance Criteria

1. THE Reward_Distribution_Contract SHALL maintain a list of Administrator addresses
2. WHEN an administrative function is called, THE Reward_Distribution_Contract SHALL verify the caller is an authorized Administrator
3. IF an unauthorized address attempts an administrative function, THEN THE Reward_Distribution_Contract SHALL revert the transaction
4. THE Reward_Distribution_Contract SHALL allow the contract owner to add or remove Administrator addresses
5. THE Reward_Distribution_Contract SHALL emit events when Administrator permissions are granted or revoked

### Requirement 7: Query and Transparency Functions

**User Story:** As a claimant, I want to query my claimable rewards and claim status, so that I know when and how much I can claim.

#### Acceptance Criteria

1. THE Reward_Distribution_Contract SHALL provide a function to query unclaimed reward amounts for a Claimant and Epoch
2. THE Reward_Distribution_Contract SHALL provide a function to check if rewards have been claimed for a specific Claimant and Epoch
3. THE Reward_Distribution_Contract SHALL provide a function to retrieve the current Epoch identifier
4. THE Reward_Distribution_Contract SHALL provide a function to query the Merkle_Root for a specific Epoch
5. THE Reward_Distribution_Contract SHALL provide a function to retrieve Distribution_Weight for an address at a specific Snapshot

### Requirement 8: Event Emission for Auditability

**User Story:** As an auditor, I want comprehensive event logs, so that I can track all reward distributions and claims for transparency.

#### Acceptance Criteria

1. WHEN an Epoch is started, THE Reward_Distribution_Contract SHALL emit an EpochStarted event with epoch identifier, timestamp, and total reward amount
2. WHEN a Claimant claims rewards, THE Reward_Distribution_Contract SHALL emit a Claimed event with claimant address, epoch identifier, and claimed amount
3. WHEN Distribution_Weights are updated, THE Reward_Distribution_Contract SHALL emit a WeightsUpdated event with affected addresses and new weights
4. WHEN a Merkle_Root is set for an Epoch, THE Reward_Distribution_Contract SHALL emit a MerkleRootSet event with epoch identifier and root hash
5. THE Reward_Distribution_Contract SHALL emit events for all state-changing operations to enable off-chain indexing

### Requirement 9: Merkle Tree Construction and Verification

**User Story:** As a system integrator, I want a well-defined Merkle tree structure, so that off-chain proof generation and on-chain verification work correctly.

#### Acceptance Criteria

1. THE Reward_Distribution_Contract SHALL define the leaf node format as hash(address, epoch_id, amount)
2. THE Reward_Distribution_Contract SHALL use a specified hash function (e.g., Keccak256 or SHA256) consistently for Merkle tree operations
3. WHEN verifying a Claim_Proof, THE Reward_Distribution_Contract SHALL reconstruct the Merkle path and compare against the stored Merkle_Root
4. THE Reward_Distribution_Contract SHALL support Merkle proofs of variable length based on tree depth
5. THE Reward_Distribution_Contract SHALL reject proofs with invalid structure or incorrect sibling hashes

### Requirement 10: Gas Efficiency and Scalability

**User Story:** As a system operator, I want the contract to minimize gas costs, so that reward distribution remains economically viable at scale.

#### Acceptance Criteria

1. THE Reward_Distribution_Contract SHALL use a pull-based claiming model to avoid gas costs of pushing rewards to all recipients
2. THE Reward_Distribution_Contract SHALL store only the Merkle_Root on-chain rather than individual allocations
3. WHEN processing claims, THE Reward_Distribution_Contract SHALL perform verification in logarithmic time relative to the number of Claimants
4. THE Reward_Distribution_Contract SHALL batch weight updates to minimize transaction overhead
5. THE Reward_Distribution_Contract SHALL optimize storage layout to minimize storage costs for Snapshots and claim records
