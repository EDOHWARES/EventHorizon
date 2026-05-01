# Poller Reputation Queue Contract

## Overview

The Poller Reputation Queue contract tracks poller performance and uptime on-chain for the EventHorizon platform. It assigns higher priority to pollers with higher reputation and emits slashing events for downtime or late reporting.

## Features

- **Reputation Tracking**: Maintains reputation scores (0-100) based on performance.
- **Uptime Monitoring**: Tracks uptime percentages and last report timestamps.
- **Priority Queue**: Provides a sorted list of pollers by reputation.
- **Slashing Events**: Emits events when reputation is reduced due to poor performance.

## API

### `init()`
Initializes the contract storage.

### `register_poller(poller: Address)`
Registers a new poller with default reputation 50 and uptime 100.

### `update_performance(poller: Address, uptime: u32, on_time: bool)`
Updates poller performance, adjusts reputation, and emits slashing events if late.

### `get_poller(poller: Address) -> Option<PollerData>`
Retrieves data for a specific poller.

### `get_priority_queue() -> Vec<PollerData>`
Returns pollers sorted by reputation (highest first).

## Events

- `poller_slashed`: Emitted when reputation is reduced. Topics: `(poller, slashed)`, Data: `(poller_address, new_reputation)`

## Data Structures

```rust
pub struct PollerData {
    pub address: Address,
    pub reputation: u32, // 0-100
    pub uptime: u32, // percentage
    pub last_report: u64,
}
```