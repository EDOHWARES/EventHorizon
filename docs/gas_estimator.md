# Gas Simulation and Estimation Proxy

## Overview
The Gas Simulation Proxy is a helper contract designed to facilitate the estimation of resource usage (CPU instructions, memory, ledger footprint) for complex or batch cross-contract calls.

## Objective
To provide a non-reverting wrapper for external contract calls, allowing developers and off-chain tools to simulate transactions and capture their full execution traces even when individual calls fail.

## Features
- **Try-Catch Wrapper**: Uses `try_invoke_contract` to wrap external calls, ensuring the proxy never reverts.
- **Batch Support**: Allows multiple simulations in a single transaction.
- **Trace Events**: Emits detailed events for every call, including success/failure status and target identifiers.

## Implementation Details
- **Function**: `simulate(call_id, target, func, args)`
- **Function**: `simulate_batch(calls)`
- **Event**: `SimResultEvent`
    - `call_id`: Correlates with the input.
    - `target`: The contract called.
    - `success`: Boolean result.
    - `resource_usage`: Placeholder field for off-chain population from RPC simulation meta.

## Usage
Used primarily by the EventHorizon platform to estimate fees and resource requirements for automated triggers.
