# Stablecoin Mint/Burn Emitter with Multi-sig Timelocks

## Overview
A secure administrative contract for managing stablecoin supply adjustments (minting and burning) through a decentralized governance process.

## Objective
To ensure that any change to the stablecoin supply is authorized by multiple administrators and subject to a mandatory cooling-off period (timelock).

## Features
- **Multi-sig Authorization**: Requires a configurable threshold of approvals from a set list of admins.
- **Timelock**: All proposals must wait for a specified duration before they can be executed.
- **Emergency Halt**: Allows admins to pause the contract in case of a detected vulnerability or market emergency.
- **Audit Logs**: Emits events for proposals, approvals, and executions to support reserve auditing.

## Implementation Details
- **Configuration**: `Admins`, `Threshold`, `Timelock`.
- **Flow**:
    1. `propose`: Create a mint/burn request.
    2. `approve`: Admins cast their votes.
    3. `execute`: Action is carried out after threshold is met and timelock expires.
- **Pause**: `set_paused` prevents all proposals and executions.

## Security Considerations
- Uses `require_auth()` for all administrative actions.
- Threshold cannot exceed the number of admins.
- Timelock cannot be bypassed.
