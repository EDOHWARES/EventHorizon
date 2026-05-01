# Multi-Asset Treasury with Governance-Voted Spending

The `TreasuryGovernance` contract is a secure, on-chain treasury for the EventHorizon platform. It holds multiple Soroban token assets and enforces governance-voted approval before any funds can be spent.

## Features

- **Multi-asset support**: Accepts deposits of XLM (wrapped) and any Soroban-compatible token.
- **Token-weighted voting**: Voting power equals the voter's governance token balance at vote time.
- **Quorum + majority enforcement**: A proposal passes only when `votes_for >= quorum` AND `votes_for > votes_against`.
- **Transparent event log**: Every deposit, proposal, vote, finalization, and spend emits a structured on-chain event.
- **Admin expiry**: Admin can mark stale proposals as `Expired` without executing them.

## Contract Interface

### `initialize(admin, gov_token, quorum, voting_period)`
One-time setup. Panics if called again.
- `gov_token`: Address of the governance token. A holder's balance is their vote weight.
- `quorum`: Minimum `votes_for` (in token units) required for a proposal to pass.
- `voting_period`: Number of ledgers a proposal stays open for voting.

### `deposit(from, asset, amount)`
Transfers `amount` of `asset` from `from` into the treasury. Any address may deposit any token.

### `propose(proposer, asset, recipient, amount, description) -> u64`
Creates a spending proposal. The proposer must hold at least 1 unit of the governance token. Returns the new proposal ID.

### `vote(voter, proposal_id, support)`
Casts a vote on an active proposal. Weight equals the voter's current governance token balance. Each address may vote once per proposal.

### `finalize(proposal_id)`
Closes voting after the `end_ledger` has passed. Sets status to `Passed` or `Rejected` based on quorum and majority rules. Anyone may call this.

### `execute(proposal_id)`
Transfers the proposed amount from the treasury to the recipient. Only callable on `Passed` proposals. Anyone may call this.

### `expire(proposal_id)`
Admin-only. Marks an `Active` proposal as `Expired` without executing it.

### `get_proposal(proposal_id) -> SpendProposal`
Returns full proposal data.

### `has_voted(proposal_id, voter) -> bool`
Returns whether an address has already voted on a proposal.

### `treasury_balance(asset) -> i128`
Returns the treasury's current balance of a given token.

### `proposal_count() -> u64`
Returns the total number of proposals ever created.

### `list_proposals(limit) -> Vec<u64>`
Returns the most recent `limit` proposal IDs.

## Data Structures

### `SpendProposal`
```rust
struct SpendProposal {
    id: u64,
    proposer: Address,
    asset: Address,        // Token to spend
    recipient: Address,    // Destination of funds
    amount: i128,
    description: Symbol,
    votes_for: i128,
    votes_against: i128,
    end_ledger: u32,       // Voting deadline
    status: ProposalStatus,
}
```

### `ProposalStatus`
```rust
enum ProposalStatus {
    Active,    // Voting open
    Passed,    // Quorum met, majority for
    Rejected,  // Quorum not met or majority against
    Executed,  // Funds transferred
    Expired,   // Marked expired by admin
}
```

## Events

| Event | Fields | Emitted when |
|---|---|---|
| `Deposited` | `asset, from, amount` | A token is deposited into the treasury |
| `ProposalCreated` | `id, proposer, asset, recipient, amount` | A new spend proposal is submitted |
| `VoteCast` | `proposal_id, voter, support, weight` | A vote is cast |
| `ProposalFinalized` | `id, status, votes_for, votes_against` | A proposal is finalized or expired |
| `SpendExecuted` | `proposal_id, asset, recipient, amount` | Treasury funds are transferred |

## Governance Flow

```
deposit(asset, amount)
        │
        ▼
propose(asset, recipient, amount)  ──► ProposalCreated event
        │
        ▼
vote(proposal_id, support)  ──► VoteCast event  (repeat for each voter)
        │
        ▼  (after end_ledger)
finalize(proposal_id)  ──► ProposalFinalized event
        │
        ▼  (if Passed)
execute(proposal_id)  ──► SpendExecuted event
```

## EventHorizon Integration

The `SpendExecuted` event is the primary hook for EventHorizon triggers. Configure a trigger with:
- **Contract ID**: deployed `TreasuryGovernance` address
- **Event name**: `SpendExecuted`
- **Action**: webhook, Discord notification, or email alert

This enables real-time off-chain notifications whenever governance approves and executes a treasury spend.

## Security Notes

- Voting weight is read at vote time, not at proposal creation. Voters who acquire tokens after a proposal is created can still vote.
- There is no delegation mechanism; each address votes with its own balance.
- The contract does not hold governance tokens — only the spend assets deposited via `deposit`.
- `execute` is permissionless once a proposal has `Passed`, ensuring liveness without requiring admin action.
