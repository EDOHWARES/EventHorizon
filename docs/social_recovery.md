# Social Recovery Module

The `social_recovery` contract provides a guardian-based recovery flow for Soroban smart accounts. It lets a trusted guardian set propose a new owner, gather approvals on-chain, and enforce a recovery timelock before ownership is rotated.

## Features

- Guardian-based recovery initiation and voting.
- Timelocked execution after the approval threshold is met.
- On-chain events for initialization, recovery requests, votes, vote revocations, cancellations, and execution.
- View methods for the current owner, guardians, active recovery state, threshold, delay, and guardian vote state.

## Contract Interface

### `initialize(owner, guardians, threshold, recovery_delay)`

Initializes the recovery module. Requirements:

- `guardians` must be non-empty and contain unique addresses.
- `threshold` must be between `1` and `guardians.len()`.
- `recovery_delay` must be at least `3600` seconds.

### `request_recovery(guardian, proposed_owner)`

Starts a recovery request. The caller must be a guardian. The request automatically records the initiating guardian's approval vote.

### `vote_recovery(guardian)`

Adds a guardian vote to the active recovery request. When approvals meet the threshold, the contract records a `ready_at` timestamp equal to `current_timestamp + recovery_delay`.

### `revoke_vote(guardian)`

Allows a guardian to retract a previously cast vote. If approvals drop below threshold, the ready timestamp is cleared and the recovery must reach threshold again before execution.

### `cancel_recovery(actor)`

Cancels the active recovery request. The current owner or any configured guardian may cancel.

### `execute_recovery(proposed_owner)`

Finalizes recovery after the timelock elapses. The proposed owner must authorize the call, which prevents forced ownership transfer to an address that has not accepted recovery.

## Event Model

The contract emits the following events:

- `Initialized`
- `RecoveryRequested`
- `RecoveryVoteCast`
- `RecoveryVoteRevoked`
- `RecoveryCancelled`
- `RecoveryExecuted`

These events support indexers, alerting systems, and off-chain user interfaces that need to surface recovery activity in real time.

## Testing

Coverage in `contracts/social_recovery/src/test.rs` includes:

- Successful end-to-end recovery execution.
- Timelock enforcement.
- Vote revocation and re-scheduling of the recovery delay.
- Owner and guardian cancellation paths.
- Rejection of non-guardian and duplicate-vote actions.
- Execution rejection for a non-nominated address.

## Performance Notes

There is not yet a dedicated standalone benchmark harness in this repository for Soroban contracts. As a lightweight benchmark signal, the test suite includes a host-budget assertion that verifies recovery execution consumes measurable Soroban CPU budget during contract execution.
