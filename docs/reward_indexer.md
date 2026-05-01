# Reward Indexer Contract

## Overview

The Reward Indexer contract provides a centralized registry to track and index rewards across multiple staking pools in the EventHorizon platform. It supports dynamic multiplier events and emits trigger-friendly events for reward availability.

## Features

- **Reward Tracking**: Stores reward data for each pool including amount, multiplier, and last update timestamp.
- **Dynamic Multipliers**: Allows updating multipliers for pools with event emission.
- **Event Emission**: Publishes events for reward availability and multiplier updates.
- **Query Interface**: Provides methods to retrieve reward data for individual pools or all pools.

## API

### `init()`
Initializes the contract storage.

### `add_reward(pool_id: Symbol, amount: i128, multiplier: u32)`
Adds or updates reward data for a pool and emits a `reward_available` event.

### `update_multiplier(pool_id: Symbol, new_multiplier: u32)`
Updates the multiplier for a pool and emits a `multiplier_updated` event.

### `get_reward(pool_id: Symbol) -> Option<RewardData>`
Retrieves reward data for a specific pool.

### `get_all_rewards() -> Vec<RewardData>`
Retrieves reward data for all pools.

## Events

- `reward_available`: Emitted when rewards are added/updated. Topics: `(reward, available)`, Data: `(pool_id, amount, multiplier)`
- `multiplier_updated`: Emitted when multiplier is updated. Topics: `(multiplier, updated)`, Data: `(pool_id, new_multiplier)`

## Data Structures

```rust
pub struct RewardData {
    pub pool_id: Symbol,
    pub amount: i128,
    pub multiplier: u32,
    pub last_updated: u64,
}
```