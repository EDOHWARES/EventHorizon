# Interest Rate Registry Contract

## Overview

The Interest Rate Registry contract manages global interest rate curves for lending pools in the EventHorizon platform. It emits telemetry events for utilization and rate changes, and supports rapid rate-spike warning events.

## Features

- **Rate Management**: Stores interest rate data including utilization percentage and rate in basis points.
- **Telemetry Events**: Emits events for rate updates with utilization data.
- **Spike Warnings**: Automatically emits warning events for high interest rates.
- **Query Interface**: Provides methods to retrieve rate data.

## API

### `init()`
Initializes the contract storage.

### `update_rate(pool_id: Symbol, utilization: u32, interest_rate: u32)`
Updates the interest rate for a pool, validates utilization <= 100, and emits events.

### `get_rate(pool_id: Symbol) -> Option<RateData>`
Retrieves rate data for a specific pool.

### `get_all_rates() -> Vec<RateData>`
Retrieves rate data for all pools.

## Events

- `rate_updated`: Emitted on rate update. Topics: `(rate, updated)`, Data: `(pool_id, utilization, interest_rate)`
- `rate_spike`: Emitted when interest_rate > 5000 (50%). Topics: `(rate, spike)`, Data: `(pool_id, interest_rate)`

## Data Structures

```rust
pub struct RateData {
    pub pool_id: Symbol,
    pub utilization: u32, // 0-100
    pub interest_rate: u32, // basis points
    pub last_updated: u64,
}
```