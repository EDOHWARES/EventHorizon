# DAO Governance: Proposal State Machine with Granular Event Logs

## Overview

This document describes the enhanced DAO Governance contract for the EventHorizon platform, focusing on the robust proposal state machine and comprehensive event logging system for Stellar Soroban.

## Table of Contents

1. [State Machine](#state-machine)
2. [Event System](#event-system)
3. [Voting Mechanism](#voting-mechanism)
4. [Delegation Logic](#delegation-logic)
5. [Event Archives](#event-archives)
6. [API Reference](#api-reference)
7. [Usage Examples](#usage-examples)
8. [Performance Considerations](#performance-considerations)

---

## State Machine

### Proposal States

The DAO Governance contract implements a granular state machine with the following states:

```
Proposed ──→ Open ──→ Closed ──→ Executed
                 │       ↓
                 │    Expired
                 └─ (if voting fails)
```

#### 1. **Proposed**
- **Description**: Initial state after proposal creation
- **Duration**: Before the voting period starts
- **Conditions**:
  - Proposal has been created by an address with voting power
  - Voting period has not yet commenced
- **Transition**: Automatically transitions to `Open` when the voting period begins
- **Events Emitted**: `ProposalCreated`

#### 2. **Open**
- **Description**: Active voting period
- **Duration**: From `start_block` to `end_block`
- **Conditions**:
  - Current block is within the voting period
  - Voters can cast votes during this state
- **Voting Rules**:
  - Each voter can only vote once per proposal
  - Delegated voters cannot vote directly; only delegatees can vote with combined power
  - Only effective voting power (own balance + delegated power) counts
- **Transition**: Automatically transitions to `Closed` when voting period ends
- **Events Emitted**: `VoteCast` (per voter)

#### 3. **Closed**
- **Description**: Voting has ended; proposal has passed and awaits execution
- **Sub-states**:
  - **Closed (Passed)**: Proposal received enough votes to pass
  - **Expired**: Proposal failed to pass (insufficient votes or quorum not met)
- **Conditions for Passing**:
  - `votes_for > votes_against`
  - `votes_for >= quorum`
- **Timelock**: If passed, must wait for `timelock_delay` before execution
- **Transition**:
  - From `Closed (Passed)` → `Executed` after timelock expires
  - From `Expired` → Terminal (cannot be queued)
- **Events Emitted**: 
  - `ProposalClosed` (with pass/fail status)
  - `VoterEngagement` (per voter, when proposal passes and is queued)

#### 4. **Executed**
- **Description**: Proposal has been executed
- **Conditions**:
  - Proposal was in `Closed` state
  - Timelock delay has passed
  - Execution function was called
- **Terminal State**: Cannot transition from this state
- **Events Emitted**: `ProposalExecuted`

### State Transition Rules

```rust
Proposed → Open
  - Triggered: When current_block > proposal.start_block
  - Automatic: On any status query after voting starts

Open → Closed
  - Triggered: When current_block > proposal.end_block
  - Automatic: On any status query after voting ends
  - Condition: votes_for > votes_against AND votes_for >= quorum

Closed → Executed
  - Triggered: By calling execute_proposal()
  - Requirements:
    - Voting period ended
    - Proposal passed (sufficient votes and quorum met)
    - Timelock expired: timestamp >= execution_time

Open → Expired (if proposal fails)
  - Triggered: When current_block > proposal.end_block
  - Automatic: On any status query
  - Condition: votes_for <= votes_against OR votes_for < quorum
```

---

## Event System

### Core Events

The DAO Governance contract emits the following events for comprehensive tracking:

#### **ProposalCreated**
```rust
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub proposer: Address,
    pub description: Symbol,
    pub start_block: u32,
    pub end_block: u32,
}
```
- **When**: Immediately when a proposal is created
- **Purpose**: Notifies external systems of new governance proposals
- **Use Case**: Frontends can display active proposals, notification systems alert stakeholders

---

#### **ProposalOpened** (Reserved)
```rust
pub struct ProposalOpened {
    pub proposal_id: u64,
    pub ledger_sequence: u32,
}
```
- **When**: When voting period begins (first transition to Open state)
- **Purpose**: Marks the beginning of active voting
- **Use Case**: Trigger reminder notifications for voters

---

#### **ProposalClosed**
```rust
pub struct ProposalClosed {
    pub proposal_id: u64,
    pub votes_for: i128,
    pub votes_against: i128,
    pub passed: bool,
    pub ledger_sequence: u32,
}
```
- **When**: Voting period ends and outcome is determined
- **Purpose**: Records final voting statistics and outcome
- **Use Case**: Archive results, determine next steps based on pass/fail

---

#### **VoteCast**
```rust
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: bool,
    pub weight: i128,
}
```
- **When**: A voter casts their vote
- **Purpose**: Track individual votes with exact weights
- **Use Case**: 
  - Real-time vote tallying on frontends
  - Audit trail of voting patterns
  - Verification of voting power at time of vote

---

#### **ProposalExecuted**
```rust
pub struct ProposalExecuted {
    pub proposal_id: u64,
    pub executed_at: u64,
}
```
- **When**: Proposal is executed after timelock
- **Purpose**: Confirm execution and record timestamp
- **Use Case**: Trigger post-execution actions, notification systems

---

#### **VoterEngagement**
```rust
pub struct VoterEngagement {
    pub proposal_id: u64,
    pub voter: Address,
    pub weight: i128,
    pub vote_count: u32,
    pub total_weight: i128,
}
```
- **When**: Proposal is queued (consensus reached)
- **Purpose**: External reward systems consume this to distribute participation rewards
- **Use Case**: Incentivize governance participation with rewards

---

#### **DelegationChanged**
```rust
pub struct DelegationChanged {
    pub delegator: Address,
    pub old_delegatee: Option<Address>,
    pub new_delegatee: Address,
    pub delegated_power: i128,
}
```
- **When**: A voter delegates voting power to another address
- **Purpose**: Track delegation changes with power amounts
- **Use Case**: 
  - Update voting power calculations
  - Audit trail of delegation patterns
  - Notification that voting power has changed

---

#### **DelegationRemoved**
```rust
pub struct DelegationRemoved {
    pub delegator: Address,
    pub former_delegatee: Address,
    pub delegated_power: i128,
}
```
- **When**: A voter removes their delegation
- **Purpose**: Track undelegation events
- **Use Case**: Update UI, recalculate voting power

---

#### **SnapshotCreated**
```rust
pub struct SnapshotCreated {
    pub snapshot_id: u64,
    pub ledger_sequence: u32,
    pub entry_count: u32,
}
```
- **When**: A voting power snapshot is taken
- **Purpose**: Record when snapshots were created
- **Use Case**: Reference snapshots for historical analysis

---

### Event Flow Diagram

```
Proposal Created
  ↓ (ProposalCreated)
Proposed State
  ↓ (on next block when old voting starts)
  └─→ ProposalOpened (if voting starts)
Open State
  ├─ (VoteCast) × N voters
  ├─ (DelegationChanged / DelegationRemoved) as needed
  ↓
Closed State
  ├─ (ProposalClosed) with result
  ├─ If Passed:
  │   └─ (VoterEngagement) × N voters
  └─ If Failed/Expired:
  │   └─ Terminal state
  ↓ (if passed, after timelock)
Executed
  └─ (ProposalExecuted)
```

---

## Voting Mechanism

### Voting Power Calculation

The effective voting power for an address is calculated as:

```
Effective Power = Own Token Balance + Sum of Delegated Balances
```

Where:
- **Own Token Balance**: Tokens held directly by the voter
- **Delegated Balances**: Tokens delegated to this voter from other addresses

Example:
```
Voter A: 100 tokens
  └─ Delegations received from:
    ├─ User B: 50 tokens
    └─ User C: 75 tokens
Result: Effective Power = 100 + 50 + 75 = 225 tokens
```

### Voting Rules

1. **One Vote Per Proposal**: A voter can only vote once per proposal
2. **Delegated Voters Cannot Vote Directly**: If a voter has delegated their power, they cannot vote directly until they undelegate
3. **Effective Power Required**: Voter must have at least 1 token of effective voting power

### Vote Recording

Each vote records:
- Proposal ID
- Voter address
- Support (true = for, false = against)
- Weight used (effective voting power at time of vote)
- Block number when vote was cast

---

## Delegation Logic

### Delegation Flow

```
Delegator ──delegates──→ Delegatee
  (loses voting ability)      (gains voting power)
                               (now votes with combined power)

Delegator ──undelegate──→ Delegatee
  (regains voting ability)  (loses delegated power)
```

### Delegation Events

Delegation changes emit `DelegationChanged` or `DelegationRemoved` events, which include:
- The delegator and delegatee addresses
- The amount of power being delegated/undelegated
- The old delegatee (if re-delegating)

### Redelegation

A delegator can redelegate to a different delegatee:

1. Current delegation to Delegatee A is removed
2. DelegationRemoved event emitted
3. New delegation to Delegatee B is created
4. DelegationChanged event emitted

### Restrictions

- **Cannot self-delegate**: An address cannot delegate to itself
- **Cannot redelegate to the same address**: If already delegated to an address, attempting to delegate to the same address again will fail
- **Delegation is all-or-nothing**: An address cannot split their delegation between multiple addresses

---

## Event Archives

### On-Chain Event Storage

All events are published to the Soroban environment and can be queried through:
1. Event indexers (e.g., RPC event queries)
2. Custom off-chain event listeners
3. EventHorizon backend event poller

### Event Query Examples

```typescript
// Query all votes on a proposal
events.filter(e => e.event.type === 'VoteCast' && e.event.data.proposal_id === 1)

// Query delegation changes for an address
events.filter(e => e.event.type === 'DelegationChanged' && 
                   e.event.data.delegator === userAddress)

// Track proposal lifecycle
events.filter(e => e.event.data.proposal_id === 1).sort(by_timestamp)
```

### External Reward System Integration

External systems can listen for `VoterEngagement` events to:
1. Track governance participation
2. Calculate reward amounts based on voting weight
3. Distribute rewards to participating voters

---

## API Reference

### Core Functions

#### `create_proposal(env, proposer, description) → u64`
Creates a new proposal (enters Proposed state)

**Parameters:**
- `env`: Smart contract environment
- `proposer`: Address creating the proposal (must have auth)
- `description`: Short proposal description (Symbol)

**Returns:** Proposal ID (u64)

**Events:** `ProposalCreated`

---

#### `vote(env, voter, proposal_id, support) → void`
Casts a vote on an active proposal (proposal must be in Open state)

**Parameters:**
- `env`: Smart contract environment
- `voter`: Address voting (must have auth)
- `proposal_id`: ID of proposal
- `support`: true for yes, false for no

**Returns:** None

**Events:** `VoteCast`

**Panics:**
- "Voting not yet started"
- "Voting has ended"
- "Already voted"
- "Delegated voters cannot vote directly"
- "No voting power"

---

#### `queue_proposal(env, proposal_id) → void`
Queues a passed proposal for execution (moves from Closed to Queued)

**Parameters:**
- `env`: Smart contract environment
- `proposal_id`: ID of proposal

**Returns:** None

**Events:** `ProposalClosed`, `VoterEngagement` (per voter)

**Requirements:**
- Voting period must have ended
- Proposal must have passed voting
- Proposal not already queued

---

#### `execute_proposal(env, proposal_id) → void`
Executes a queued proposal (transitions to Executed state)

**Parameters:**
- `env`: Smart contract environment
- `proposal_id`: ID of proposal

**Returns:** None

**Events:** `ProposalExecuted`

**Requirements:**
- Proposal must be queued
- Timelock delay must have passed

---

#### `delegate(env, delegator, delegatee) → void`
Delegates voting power to another address

**Parameters:**
- `env`: Smart contract environment
- `delegator`: Address delegating (must have auth)
- `delegatee`: Address receiving delegation

**Returns:** None

**Events:** `DelegationChanged`

---

#### `undelegate(env, delegator) → void`
Removes delegation, restoring direct voting ability

**Parameters:**
- `env`: Smart contract environment
- `delegator`: Address undelegating (must have auth)

**Returns:** None

**Events:** `DelegationRemoved`

---

#### `get_status(env, proposal_id) → ProposalStatus`
Returns the current state of a proposal

**Parameters:**
- `env`: Smart contract environment
- `proposal_id`: ID of proposal

**Returns:** ProposalStatus enum
- `Proposed`
- `Open`
- `Closed`
- `Executed`
- `Expired`

---

#### `get_proposal(env, proposal_id) → Proposal`
Returns full proposal data

**Returns:**
```rust
{
  id: u64,
  proposer: Address,
  description: Symbol,
  votes_for: i128,
  votes_against: i128,
  start_block: u32,
  end_block: u32,
  execution_time: u64,
  executed: bool,
  outcome: ProposalOutcome,
}
```

---

#### `get_voter_metrics(env, voter) → VoterMetrics`
Returns participation metrics for a voter

**Returns:**
```rust
{
  total_weight: i128,        // Cumulative voting weight
  vote_count: u32,           // Number of proposals voted on
  first_vote_ledger: u32,    // Ledger sequence of first vote
  last_vote_ledger: u32,     // Ledger sequence of most recent vote
}
```

---

#### `get_voting_power(env, voter) → i128`
Returns the current effective voting power for an address

---

#### `get_delegation(env, delegator) → Option<DelegationInfo>`
Returns delegation info for an address (if delegated)

---

#### `get_incoming_delegations(env, delegatee) → Vec<DelegationInfo>`
Returns all delegations received by an address

---

#### `snapshot_voting_power(env) → u64`
Takes a snapshot of current voting power for all voters (admin only)

**Returns:** Snapshot ID

**Events:** `SnapshotCreated`

---

#### `get_snapshot(env, snapshot_id) → PowerSnapshot`
Retrieves a previously taken snapshot

---

## Usage Examples

### Example 1: Create and Vote on a Proposal

```rust
// Create proposal
let proposal_id = gov_client.create_proposal(
    &proposer, 
    &Symbol::new(&env, "increase_quorum")
);

// Check status - should be Proposed
assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Proposed);

// Wait for voting period to start
env.ledger().set_sequence(env.ledger().sequence() + 1);

// Check status - now Open
assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Open);

// Vote in favor
gov_client.vote(&voter, &proposal_id, &true);
```

### Example 2: Delegate and Vote with Combined Power

```rust
// Voter A has 100 tokens, Voter B has 200 tokens
// A delegates to B

gov_client.delegate(&voter_a, &voter_b);

// B's effective power is now 200 + 100 = 300

let proposal_id = gov_client.create_proposal(&voter_b, &Symbol::new(&env, "proposal"));

// B votes - vote counts as 300 power
gov_client.vote(&voter_b, &proposal_id, &true);

// Query metrics
let proposal = gov_client.get_proposal(proposal_id);
assert_eq!(proposal.votes_for, 300);  // Combined power used
```

### Example 3: Full Lifecycle with Execution

```rust
// 1. Create
let proposal_id = gov_client.create_proposal(&proposer, &description);

// 2. Start voting period, vote, reach consensus
env.ledger().set_sequence(env.ledger().sequence() + 1);
gov_client.vote(&voter, &proposal_id, &true);

// 3. End voting, queue
env.ledger().set_sequence(env.ledger().sequence() + 101);
gov_client.queue_proposal(&proposal_id);
assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Closed);

// 4. Wait for timelock
env.ledger().set_timestamp(env.ledger().timestamp() + 3600 + 1);

// 5. Execute
gov_client.execute_proposal(&proposal_id);
assert_eq!(gov_client.get_status(&proposal_id), ProposalStatus::Executed);
```

---

## Performance Considerations

### Storage Optimization

1. **Voter Lists**: Proposals maintain a list of voters for efficient engagement event emission
2. **Delegation Tracking**: Maintains both outgoing and incoming delegation records
3. **Metrics Accumulation**: Voter metrics updated incrementally during voting

### Gas Optimization

1. **Event Batching**: Multiple events are published in batches to minimize transactions
2. **Snapshot Efficiency**: Only addresses that have voted or delegated are included
3. **Effective Power Calculation**: Cached during voting for efficiency

### Scaling Considerations

For large-scale governance with thousands of participants:

1. **Implement event indexing** using EventHorizon's backend
2. **Use periodic snapshots** to reduce real-time calculation load
3. **Consider implementing delegation limits** if needed
4. **Archive old proposals** into separate storage contracts

---

## Testing

The DAO Governance contract includes comprehensive test coverage:

- ✅ State machine transition tests
- ✅ Event emission tests
- ✅ Voting logic tests
- ✅ Delegation tests
- ✅ Metrics accumulation tests
- ✅ Snapshot tests
- ✅ Integration tests with multiple participants
- ✅ Edge case tests

### Running Tests

```bash
cd contracts/dao_governance
cargo test --lib
```

---

## Future Enhancements

1. **Partial Delegation**: Allow splitting delegation between multiple addresses
2. **Weighted Voting**: Implement different voting weight multipliers
3. **Proposal Amendments**: Allow proposal modifications before voting ends
4. **Vote Change**: Allow voters to change their vote before voting ends
5. **Voting Analytics**: Enhanced historical analysis capabilities
6. **Time-Weighted Voting**: Consider voting power over time

---

## References

- [Stellar Soroban Documentation](https://stellar.org/developers/soroban)
- [EventHorizon Architecture Overview](./README.md)
- [DAO Governance Contract Code](../contracts/dao_governance/src/lib.rs)

