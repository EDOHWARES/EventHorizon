# Reward Pool for High-Uptime Protocol Node Operators

The `RewardPoolContract` is a Soroban smart contract that automates reward distribution to protocol node operators based on verified uptime. Nodes earn tokens for every polling window they participate in and are penalized for missed windows, creating a strong incentive for high availability.

## Features

- **Automated Payouts**: Rewards are calculated on-chain from reported vs. expected polling windows.
- **Uptime Tracking**: Each node's contribution events are recorded cumulatively.
- **Penalty Logic**: Missed polling windows reduce pending rewards, preventing free-riding.
- **Permissionless Claiming**: Node operators pull their own rewards at any time.
- **Pool Funding**: Anyone (typically the admin) can deposit reward tokens into the pool.

## Contract Interface

### `initialize(admin, reward_token, reward_per_window, penalty_per_window)`
Initializes the contract. Can only be called once.
- `admin`: Administrative address.
- `reward_token`: Address of the token paid out as rewards.
- `reward_per_window`: Tokens earned per reported window (scaled by `1_000_000`). E.g. `10_000_000` = 10 tokens.
- `penalty_per_window`: Tokens deducted per missed window (scaled by `1_000_000`). Set to `0` to disable penalties.

### `fund(from, amount)`
Deposits `amount` of reward tokens from `from` into the pool. `from` must authorize the call.

### `report(node, windows_reported, windows_expected)`
Called by a node operator to record participation in one or more polling windows.
- `node`: The node operator's address (must authorize).
- `windows_reported`: Number of windows the node successfully participated in.
- `windows_expected`: Total windows that elapsed since the last report.
- Rewards and penalties are calculated immediately and added to `pending_rewards`.

### `claim(node) -> i128`
Transfers all `pending_rewards` for `node` to the node's address. Returns the amount claimed. Panics if there are no rewards to claim.

### `get_node_info(node) -> NodeInfo`
Returns the full uptime and reward state for a node.

### `get_uptime_ratio(node) -> i128`
Returns the node's lifetime uptime ratio scaled by `1_000_000`.  
Example: `950_000` = 95.0% uptime.

## Data Structures

### `NodeInfo`
```rust
struct NodeInfo {
    windows_expected: u64,  // Total windows the node was expected to report
    windows_reported: u64,  // Windows the node actually reported
    pending_rewards: i128,  // Accumulated unclaimed rewards (in token units)
    last_report_ts: u64,    // Ledger timestamp of the last report call
}
```

## Reward Calculation

For each `report` call:

```
earned  = windows_reported  × reward_per_window  / SCALAR
penalty = windows_missed    × penalty_per_window / SCALAR
delta   = max(0, earned - penalty)
pending_rewards += delta
```

`SCALAR = 1_000_000` provides sub-token precision for rate configuration.

## Events

| Event | Key | Value |
|-------|-----|-------|
| `report` | `(Symbol("report"), node)` | `(windows_reported, windows_expected, delta)` |
| `claim`  | `(Symbol("claim"),  node)` | `amount` |
| `fund`   | `(Symbol("fund"),   from)` | `amount` |

## Usage Example

```bash
# 1. Deploy and initialize
soroban contract invoke --id $CONTRACT_ID -- initialize \
  --admin $ADMIN \
  --reward_token $TOKEN \
  --reward_per_window 10000000 \
  --penalty_per_window 2000000

# 2. Fund the pool
soroban contract invoke --id $CONTRACT_ID -- fund \
  --from $ADMIN --amount 1000000000

# 3. Node reports 9 out of 10 windows
soroban contract invoke --id $CONTRACT_ID -- report \
  --node $NODE --windows_reported 9 --windows_expected 10

# 4. Node claims rewards
soroban contract invoke --id $CONTRACT_ID -- claim --node $NODE
```

## Integration with EventHorizon

The EventHorizon poller worker can call `report` on behalf of each registered node after every polling epoch, using the node's verified participation count. This closes the loop between off-chain event detection and on-chain reward settlement.
