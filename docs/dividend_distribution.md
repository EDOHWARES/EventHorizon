# Dividend Distribution Contract

## Overview

The Dividend Distribution Contract enables automated dividend distribution based on staking events in the EventHorizon platform. It operates on an epoch-based system where dividends are calculated proportionally to staked amounts at the start of each epoch and distributed at the end.

## Key Features

- **Epoch-Based Distribution**: Dividends are distributed in fixed-time epochs.
- **Proportional Allocation**: Dividends are allocated based on the proportion of tokens staked by each user at the epoch start.
- **Automated Processing**: Admins can trigger epoch processing to calculate and distribute dividends automatically.
- **Granular Reporting**: Detailed reports are emitted for each epoch, including per-user dividend information.
- **Gas Optimization**: Designed for efficient distribution in mass scenarios.

## Architecture

### Contracts Involved

- **DividendDistributionContract**: Main contract handling epoch management, calculation, and distribution.
- **StakingContract**: Provides staking data; the dividend contract snapshots staking positions at epoch start.

### Data Structures

- **EpochInfo**: Contains epoch metadata (ID, timestamps, total staked, dividends, distribution status).
- **DividendInfo**: Per-user dividend details (user address, staked amount, dividend amount, epoch ID).

### Events

- `new_epoch(epoch_id, start_ts, end_ts, total_staked)`: Emitted when a new epoch starts.
- `dividend_distributed(user, epoch_id, amount)`: Emitted for each user dividend distribution.
- `epoch_distribution_complete(epoch_id, total_distributed)`: Emitted when epoch distribution finishes.

## Functions

### Initialization

- `initialize(admin, staking_contract, dividend_token, epoch_duration, initial_dividend_pool)`: Sets up the contract parameters and funds the dividend pool.

### Epoch Management

- `start_new_epoch(admin)`: Begins a new epoch, snapshots current staking positions.
- `process_epoch(admin)`: If the current epoch has ended, calculates and distributes dividends.

### Dividend Operations

- `calculate_dividends(epoch_id)`: Computes dividends for an epoch based on staked snapshots.
- `distribute_dividends(epoch_id)`: Transfers dividend tokens to users and emits reports.

### Reporting

- `get_epoch_report(epoch_id)`: Returns epoch info and list of dividend distributions.

## Usage

1. Initialize the contract with admin, staking contract address, dividend token, epoch duration, and initial pool.
2. Start a new epoch to snapshot staking positions.
3. At epoch end, call `process_epoch` to automatically calculate and distribute dividends.
4. Query `get_epoch_report` for detailed distribution reports.

## Integration with Staking

The contract snapshots staking data at epoch start. For full automation, the staking contract could call dividend functions on stake/unstake events, but currently, epochs are admin-managed.

## Security Considerations

- Only admin can start epochs and process distributions.
- Dividend pool is held in the contract; ensure sufficient funds.
- Calculations use fixed-point arithmetic for precision.

## Testing

Unit tests cover initialization, epoch management, dividend calculation, and distribution. Integration tests verify interaction with staking contract.