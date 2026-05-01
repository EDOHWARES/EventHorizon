# Burnable Token (Supply-Check + Burn Velocity)

A minimal Soroban token contract that supports minting, transfers, approvals/allowances, and burning with analytics-friendly events.

## Initialization

`initialize(admin, name, symbol, decimals, burn_window_seconds)`

- `burn_window_seconds` defines the rolling window used for burn-velocity tracking.

## Core Methods

- `mint(to, amount)` (admin-only)
- `transfer(from, to, amount)` (requires `from` auth)
- `approve(owner, spender, amount)` (requires `owner` auth)
- `burn(from, amount)` (requires `from` auth)
- `burn_from(spender, from, amount)` (requires `spender` auth and allowance)

## Views

- `total_supply()`
- `balance(id)`
- `allowance(owner, spender)`
- `burned_total()`
- `burn_velocity()` → `{ window_start, now, burned_in_window, velocity_per_sec, window_seconds }`

## Events

The contract emits events to support indexing and analytics:

- `SupplyChecked { delta, total_supply }` on every `mint` and `burn`.
- `BurnVelocityUpdated { window_start, now, burned_in_window, velocity_per_sec, window_seconds }` on every `burn` / `burn_from`.
- `Burned { from, amount, new_total_supply }` on every `burn` / `burn_from`.

