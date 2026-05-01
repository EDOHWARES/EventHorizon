# DAO Whitelist — DAO-managed Whitelist for High-priority Trigger Events

The `DaoWhitelist` contract maintains a governance-controlled list of high-priority contract addresses. Contracts on this whitelist are polled at lower latency by EventHorizon workers, ensuring faster event detection for trusted, high-value integrations.

## Features

- **Token-weighted Governance**: Any governance token holder can propose adding or removing a contract. Vote weight equals the voter's token balance.
- **Quorum Enforcement**: Proposals only pass if FOR votes meet the configured quorum threshold and exceed AGAINST votes.
- **Priority Tiers**: Each whitelisted contract has a numeric priority tier that EventHorizon workers use to determine polling frequency.
- **Emergency Removal**: The admin can remove a contract immediately without going through governance.
- **On-chain Events**: Every proposal, vote, whitelist change, and priority update emits a structured event.

## Contract Interface

### `initialize(admin, voting_token, quorum, voting_period)`
One-time setup.
- `admin`: Security committee address with emergency powers.
- `voting_token`: Address of the governance token (balance = vote weight).
- `quorum`: Minimum FOR-vote weight required for a proposal to pass (must be > 0).
- `voting_period`: Default duration in seconds for new proposals (must be > 0).

### `propose(proposer, target, action) -> u64`
Any token holder can submit a governance proposal. Returns the proposal ID.
- `proposer`: Must hold at least 1 token unit.
- `target`: The contract address to add or remove.
- `action`: `ProposalAction::Add(label)` or `ProposalAction::Remove`.

### `vote(voter, proposal_id, support)`
Cast a vote on an open proposal.
- `support`: `true` = FOR, `false` = AGAINST.
- Vote weight equals the voter's current token balance.
- Panics if the voting period has ended, the voter has already voted, or the voter has no tokens.

### `execute(proposal_id)`
Execute a successful proposal after the voting period ends.
- Panics if the proposal failed (quorum not met or AGAINST ≥ FOR), the period has not ended, or the proposal was already executed.
- On success: adds or removes the target contract from the whitelist.

### `set_priority(admin, target, priority)`
Admin-only. Sets the priority tier of a whitelisted contract.
- Higher priority = more frequent polling by EventHorizon workers.
- Panics if `target` is not whitelisted.

### `emergency_remove(admin, target)`
Admin-only. Immediately removes a contract from the whitelist, bypassing governance.

### `is_whitelisted(target) -> bool`
Returns `true` if the contract is currently on the whitelist.

### `get_entry(target) -> WhitelistEntry`
Returns the whitelist metadata for a contract.

### `get_proposal(proposal_id) -> WhitelistProposal`
Returns the full proposal record.

### `get_proposal_count() -> u64`
Returns the total number of proposals created.

## Data Structures

### `ProposalAction`
```rust
enum ProposalAction {
    Add(String),  // label / description for the whitelisted contract
    Remove,
}
```

### `WhitelistProposal`
```rust
struct WhitelistProposal {
    id: u64,
    proposer: Address,
    target: Address,
    action: ProposalAction,
    votes_for: i128,
    votes_against: i128,
    end_time: u64,      // Unix timestamp when voting closes
    executed: bool,
}
```

### `WhitelistEntry`
```rust
struct WhitelistEntry {
    label: String,      // Human-readable description
    added_by: Address,  // Proposer address
    added_at: u64,      // Ledger timestamp of addition
    priority: u32,      // Polling priority tier (default: 1)
}
```

## Events

| Topic | Data | Description |
|-------|------|-------------|
| `("prop_new", proposal_id)` | `(proposer, target, is_removal)` | New proposal created |
| `("voted", proposal_id)` | `(voter, support, voting_power)` | Vote cast |
| `("wl_add", target)` | `(proposal_id, label)` | Contract added to whitelist |
| `("wl_rem", target)` | `proposal_id` | Contract removed via governance |
| `("priority", target)` | `priority` | Priority tier updated |
| `("emrg_rem", target)` | `()` | Emergency removal by admin |

## Storage Layout

| Key | Storage Type | Description |
|-----|-------------|-------------|
| `Admin` | Instance | Admin address |
| `VotingToken` | Instance | Governance token address |
| `Quorum` | Instance | Minimum FOR-vote threshold |
| `VotingPeriod` | Instance | Default proposal duration (seconds) |
| `ProposalCount` | Instance | Total proposals created |
| `Proposal(id)` | Persistent | Proposal record |
| `Voted(id, voter)` | Persistent | Per-voter vote flag |
| `Whitelist(address)` | Persistent | Whitelist entry |

## Integration with EventHorizon

The primary integration point is the whitelist itself: EventHorizon's polling worker reads the `Whitelist` storage entries to determine which contracts to monitor at elevated frequency.

Workers can also subscribe to governance events:

- **`wl_add`** – automatically register a new high-priority trigger when a contract is whitelisted.
- **`wl_rem`** / **`emrg_rem`** – automatically downgrade or deregister a trigger when a contract is removed.

Configure a trigger in the EventHorizon dashboard with the deployed contract ID and event name (e.g., `wl_add`).

## Governance Flow

```
1. Token holder calls propose(target, Add("My DEX"))
   → proposal_id returned, voting window opens

2. Token holders call vote(proposal_id, true/false)
   → votes accumulate weighted by token balance

3. After voting_period seconds, anyone calls execute(proposal_id)
   → if votes_for >= quorum AND votes_for > votes_against:
       contract is added to whitelist with priority = 1
   → otherwise: panics with "Proposal failed"

4. Admin can call set_priority(target, 5) to elevate polling frequency

5. In an emergency, admin calls emergency_remove(target)
   → contract removed immediately, no governance required
```

## Security Considerations

- **Snapshot-less voting**: Vote weight is read at vote time, not at proposal creation. Large token holders who acquire tokens after a proposal is created can still influence the outcome.
- **No vote delegation**: Each address votes with its own balance. Delegation is not supported in this version.
- **Quorum must be set carefully**: Too low a quorum allows small token holders to whitelist contracts; too high may make governance impractical.
- **Emergency remove is a privileged operation**: Restrict the admin key and consider a multi-sig wallet as the admin address for production deployments.
