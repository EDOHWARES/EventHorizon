# Implementation Plan: Periodic Reward Distribution

## Overview

This implementation plan creates a gas-efficient Merkle tree-based reward distribution system for Soroban smart contracts. The contract uses a pull-based claiming model with epoch management, weight snapshots, and comprehensive event emission.

## Tasks

- [ ] 1. Set up project structure and core types
  - Create contract directory structure under `contracts/reward_distribution`
  - Define error types enum with all error variants
  - Define DataKey enum for storage keys
  - Define EpochInfo and WeightSnapshot structs
  - Set up Cargo.toml with soroban-sdk dependency
  - _Requirements: 6.2, 6.3_

- [ ] 2. Implement contract initialization
  - [ ] 2.1 Create initialize function with admin and reward token parameters
    - Store admin address in instance storage
    - Store reward token address in instance storage
    - Initialize current epoch counter to 0
    - Initialize empty admin set with owner as first admin
    - Emit initialization event
    - _Requirements: 6.1, 6.4_
  
  - [ ]* 2.2 Write property test for initialization
    - **Property 1: Initialization idempotence check**
    - **Validates: Requirements 6.1**
    - Generate random admin and token addresses, verify initialization succeeds once and fails on second attempt

- [ ] 3. Implement admin management functions
  - [ ] 3.1 Create add_admin function
    - Verify caller is owner
    - Add address to admin set in storage
    - Emit AdminAdded event
    - _Requirements: 6.1, 6.4, 6.5_
  
  - [ ] 3.2 Create remove_admin function
    - Verify caller is owner
    - Remove address from admin set
    - Emit AdminRemoved event
    - _Requirements: 6.1, 6.4, 6.5_
  
  - [ ] 3.3 Create is_admin query function
    - Check if address exists in admin set
    - Return boolean result
    - _Requirements: 6.1, 6.2_
  
  - [ ]* 3.4 Write property test for admin management
    - **Property 19: Admin list management round-trip**
    - **Validates: Requirements 6.1, 6.4**
    - Generate admin add/remove operations, verify queries reflect changes
  
  - [ ]* 3.5 Write property test for access control
    - **Property 20: Access control enforcement**
    - **Validates: Requirements 6.2, 6.3**
    - Generate non-admin addresses, verify admin function calls fail
  
  - [ ]* 3.6 Write property test for admin events
    - **Property 21: Admin event emission**
    - **Validates: Requirements 6.5**
    - Generate admin operations, verify events emitted correctly

- [ ] 4. Implement weight management functions
  - [ ] 4.1 Create set_weight function for single address
    - Verify caller is admin
    - Verify no active epoch (weight updates only between epochs)
    - Validate weight is non-negative
    - Store weight in DistributionWeight storage
    - Emit WeightUpdated event
    - _Requirements: 3.1, 3.2, 8.3_
  
  - [ ] 4.2 Create set_weights batch function
    - Verify caller is admin
    - Verify no active epoch
    - Validate all weights are non-negative
    - Validate total weights don't exceed maximum
    - Store all weights in loop
    - Emit WeightsUpdated event with all addresses
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.4_
  
  - [ ] 4.3 Create get_weight query function
    - Read and return weight for address from storage
    - Return 0 if not set
    - _Requirements: 3.1, 7.5_
  
  - [ ]* 4.4 Write property test for weight persistence
    - **Property 11: Weight update persistence round-trip**
    - **Validates: Requirements 3.1**
    - Generate random weights, update, verify queries return correct values
  
  - [ ]* 4.5 Write property test for weight timing constraint
    - **Property 12: Weight update timing constraint**
    - **Validates: Requirements 3.2**
    - Generate active epoch state, attempt weight update, verify failure
  
  - [ ]* 4.6 Write property test for weight maximum validation
    - **Property 13: Weight maximum validation**
    - **Validates: Requirements 3.3**
    - Generate weights exceeding maximum, verify rejection
  
  - [ ]* 4.7 Write property test for batch equivalence
    - **Property 14: Batch weight update equivalence**
    - **Validates: Requirements 3.4, 10.4**
    - Generate weight sets, compare batch vs individual updates
  
  - [ ]* 4.8 Write property test for weight events
    - **Property 15: Weight update event emission**
    - **Validates: Requirements 3.5, 8.3**
    - Generate weight updates, verify events emitted

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement snapshot capture mechanism
  - [ ] 6.1 Create capture_snapshot internal function
    - Read all current distribution weights from storage
    - Calculate total weight sum
    - Create WeightSnapshot struct with epoch_id, weights map, and total
    - Store snapshot in WeightSnapshot(epoch_id) storage key
    - _Requirements: 1.3, 4.1, 4.4_
  
  - [ ] 6.2 Create get_snapshot_weight query function
    - Read snapshot for given epoch_id
    - Return weight for address from snapshot
    - Return 0 if address not in snapshot
    - _Requirements: 4.2, 4.5, 7.5_
  
  - [ ]* 6.3 Write property test for snapshot capture
    - **Property 3: Snapshot capture on epoch start**
    - **Validates: Requirements 1.3, 4.1**
    - Generate random weights, start epoch, verify snapshot matches current weights
  
  - [ ]* 6.4 Write property test for snapshot immutability
    - **Property 16: Snapshot immutability**
    - **Validates: Requirements 4.2, 4.3, 4.5**
    - Generate snapshot, modify weights, verify snapshot unchanged
  
  - [ ]* 6.5 Write property test for snapshot integrity
    - **Property 17: Snapshot data integrity**
    - **Validates: Requirements 4.4**
    - Generate snapshot, query multiple times, verify identical results

- [ ] 7. Implement epoch management functions
  - [ ] 7.1 Create start_epoch function
    - Verify caller is admin
    - Verify no active epoch exists
    - Increment current epoch counter
    - Capture weight snapshot for new epoch
    - Create EpochInfo with epoch_id, timestamp, total_rewards, finalized=false
    - Store EpochInfo in storage
    - Emit EpochStarted event
    - Return new epoch_id
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.1_
  
  - [ ] 7.2 Create set_merkle_root function
    - Verify caller is admin
    - Verify epoch exists
    - Verify epoch not finalized
    - Update EpochInfo with merkle_root
    - Store updated EpochInfo
    - Emit MerkleRootSet event
    - _Requirements: 1.5, 8.4_
  
  - [ ] 7.3 Create finalize_epoch function
    - Verify caller is admin
    - Verify epoch exists
    - Verify merkle_root is set
    - Update EpochInfo with finalized=true
    - Store updated EpochInfo
    - Emit EpochFinalized event
    - _Requirements: 1.4, 1.5_
  
  - [ ] 7.4 Create get_current_epoch query function
    - Read and return current epoch counter
    - _Requirements: 7.3_
  
  - [ ] 7.5 Create get_epoch_info query function
    - Read and return EpochInfo for given epoch_id
    - Return error if epoch not found
    - _Requirements: 7.3, 7.4_
  
  - [ ] 7.6 Create get_merkle_root query function
    - Read EpochInfo for given epoch_id
    - Return merkle_root if set
    - Return error if not set or epoch not found
    - _Requirements: 7.4_
  
  - [ ]* 7.7 Write property test for epoch ID uniqueness
    - **Property 1: Epoch ID uniqueness**
    - **Validates: Requirements 1.1**
    - Generate sequence of epoch starts, verify all IDs unique
  
  - [ ]* 7.8 Write property test for epoch start events
    - **Property 2: Epoch start event emission**
    - **Validates: Requirements 1.2, 8.1**
    - Generate epoch starts, verify events emitted with correct data
  
  - [ ]* 7.9 Write property test for single active epoch
    - **Property 4: Single active epoch invariant**
    - **Validates: Requirements 1.4**
    - Generate active epoch state, verify new epoch start fails
  
  - [ ]* 7.10 Write property test for merkle root persistence
    - **Property 5: Merkle root persistence round-trip**
    - **Validates: Requirements 1.5**
    - Generate random merkle roots, set and query, verify round-trip
  
  - [ ]* 7.11 Write property test for merkle root set events
    - **Property 23: Merkle root set event emission**
    - **Validates: Requirements 8.4**
    - Generate merkle root sets, verify events emitted

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Merkle proof verification
  - [ ] 9.1 Create verify_merkle_proof internal function
    - Construct leaf hash from (claimant, epoch_id, amount) using SHA256
    - Iterate through proof siblings
    - For each sibling, combine with computed hash (sorted order)
    - Hash combined bytes using SHA256
    - Compare final computed hash with stored merkle_root
    - Return boolean result
    - _Requirements: 2.1, 9.1, 9.2, 9.3, 9.4_
  
  - [ ]* 9.2 Write property test for valid proof verification
    - **Property 6: Valid proof verification**
    - **Validates: Requirements 2.1, 9.3**
    - Generate valid Merkle trees and proofs, verify acceptance
  
  - [ ]* 9.3 Write property test for invalid proof rejection
    - **Property 10: Invalid proof rejection**
    - **Validates: Requirements 2.5, 9.5**
    - Generate invalid proofs (mutated siblings, wrong data), verify rejection
  
  - [ ]* 9.4 Write property test for leaf format consistency
    - **Property 24: Leaf node format consistency**
    - **Validates: Requirements 9.1**
    - Generate claims, verify leaf constructed as hash(address || epoch_id || amount)
  
  - [ ]* 9.5 Write property test for hash function consistency
    - **Property 25: Hash function consistency**
    - **Validates: Requirements 9.2**
    - Generate Merkle operations, verify SHA256 used throughout
  
  - [ ]* 9.6 Write property test for variable length proofs
    - **Property 26: Variable length proof support**
    - **Validates: Requirements 9.4**
    - Generate proofs of varying lengths, verify all work correctly

- [ ] 10. Implement reward claiming function
  - [ ] 10.1 Create claim function
    - Verify claimant authorization
    - Verify epoch exists and is finalized
    - Verify merkle_root is set for epoch
    - Check if already claimed using ClaimRecord storage
    - Verify merkle proof using verify_merkle_proof
    - Mark as claimed in ClaimRecord(claimant, epoch_id) storage
    - Transfer reward tokens from contract to claimant
    - Emit Claimed event
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.2_
  
  - [ ] 10.2 Create is_claimed query function
    - Read ClaimRecord(claimant, epoch_id) from storage
    - Return boolean indicating if claimed
    - _Requirements: 2.4, 7.2_
  
  - [ ]* 10.3 Write property test for successful claim token transfer
    - **Property 7: Successful claim token transfer**
    - **Validates: Requirements 2.2**
    - Generate valid claims, verify balance increases by claimed amount
  
  - [ ]* 10.4 Write property test for claim events
    - **Property 8: Claim event emission**
    - **Validates: Requirements 2.3, 8.2**
    - Generate valid claims, verify events emitted
  
  - [ ]* 10.5 Write property test for double claim prevention
    - **Property 9: Double claim prevention**
    - **Validates: Requirements 2.4, 2.6**
    - Generate claims, attempt duplicate, verify second fails
  
  - [ ]* 10.6 Write property test for claim status query
    - **Property 22: Claim status query accuracy**
    - **Validates: Requirements 7.2**
    - Generate claims, verify status query returns correct values

- [ ] 11. Implement token compatibility
  - [ ] 11.1 Add token transfer helper function
    - Use soroban_sdk token client interface
    - Handle transfer from contract to claimant
    - Handle error cases from token contract
    - _Requirements: 5.5_
  
  - [ ]* 11.2 Write property test for token type compatibility
    - **Property 18: Token type compatibility**
    - **Validates: Requirements 5.5**
    - Generate different token addresses, verify transfers work

- [ ] 12. Implement storage efficiency optimizations
  - [ ] 12.1 Optimize snapshot storage layout
    - Use efficient Map structure for weights
    - Consider delta compression for large snapshots
    - Set appropriate TTL for snapshot data
    - _Requirements: 10.2, 10.5_
  
  - [ ] 12.2 Optimize claim record storage
    - Use boolean flags in persistent storage
    - Set appropriate TTL for claim records
    - _Requirements: 10.2, 10.5_
  
  - [ ]* 12.3 Write property test for storage efficiency
    - **Property 27: Storage efficiency**
    - **Validates: Requirements 10.2**
    - Generate epochs, verify only merkle root stored (not individual allocations)

- [ ] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Add comprehensive error handling
  - [ ] 14.1 Add validation for all input parameters
    - Validate addresses are not zero
    - Validate amounts are non-negative
    - Validate epoch IDs are valid
    - Validate proof arrays are not empty
    - _Requirements: 2.5, 3.3_
  
  - [ ] 14.2 Add descriptive error messages for all error types
    - Ensure each error variant has clear meaning
    - Add context to error returns where helpful
    - _Requirements: 2.5, 6.3_
  
  - [ ]* 14.3 Write unit tests for all error conditions
    - Test each error type is triggered correctly
    - Verify state unchanged after errors
    - Verify no events emitted on errors

- [ ] 15. Integration and wiring
  - [ ] 15.1 Wire all functions into contract trait implementation
    - Implement RewardDistribution trait
    - Ensure all functions are exposed
    - Add contract metadata and documentation
    - _Requirements: All_
  
  - [ ] 15.2 Create contract deployment script
    - Set up deployment configuration
    - Add initialization parameters
    - Document deployment process
    - _Requirements: 6.1_
  
  - [ ]* 15.3 Write integration tests for end-to-end flows
    - Test complete epoch lifecycle
    - Test weight update → snapshot → claim flow
    - Test multi-claimant scenarios
    - Test admin management flows
    - _Requirements: All_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use proptest framework with minimum 100 iterations
- All property tests are tagged with property number and validated requirements
- Checkpoints ensure incremental validation throughout implementation
- Storage optimization tasks ensure gas efficiency at scale
