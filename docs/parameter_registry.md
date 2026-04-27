# Parameter Registry

The Parameter Registry is a global configuration hub for the EventHorizon protocol. It provides a single, governance-controlled source of truth for protocol-wide settings such as fees, operational thresholds, and other tunable values.

## Features

- **Central Configuration Hub**: All protocol parameters (fees, thresholds, limits) stored in one contract.
- **Governance-Only Updates**: Only the designated governance address (e.g. a DAO contract) can set or remove parameters.
- **Detailed Events**: Every configuration change emits an event with the old and new values for full auditability.
- **Safe Defaults**: `get_param_or_default` allows callers to handle missing parameters gracefully.

## Contract Functions

### `initialize(admin: Address, governance: Address)`
Initializes the registry. Can only be called once.
- `admin` – bootstrap admin address (can transfer governance).
- `governance` – address authorized to update parameters (e.g. a DAO or multisig).

### `set_governance(new_governance: Address)`
Transfers governance to a new address. Admin only.

### `set_param(key: Symbol, value: i128)`
Creates or updates a protocol parameter. Governance only.
- `key` – parameter name (e.g. `"protocol_fee"`, `"max_slippage"`).
- `value` – i128 value; use basis points (bps) or fixed-point as appropriate for the parameter.

### `remove_param(key: Symbol)`
Removes a parameter. Governance only. Panics if the parameter does not exist.

### `get_param(key: Symbol) -> i128`
Returns the stored value. Panics if the parameter is not set.

### `get_param_or_default(key: Symbol, default: i128) -> i128`
Returns the stored value, or `default` if the parameter is not set.

### `has_param(key: Symbol) -> bool`
Returns `true` if the parameter exists.

### `get_admin() -> Address`
Returns the admin address.

### `get_governance() -> Address`
Returns the current governance address.

## Events

| Topic | Data | Description |
|-------|------|-------------|
| `("init", admin)` | `governance` | Emitted on initialization. |
| `("gov_changed", old_gov)` | `new_gov` | Emitted when governance is transferred. |
| `("param_set", key)` | `(old_value, new_value)` | Emitted when a parameter is created or updated. `old_value` is `0` for new parameters. |
| `("param_removed", key)` | `old_value` | Emitted when a parameter is removed. |

## Example Usage

### Setting protocol fees (from a governance contract)

```rust
// 30 basis points = 0.30%
registry_client.set_param(&Symbol::new(&env, "protocol_fee"), &30i128);

// 200 bps max slippage = 2%
registry_client.set_param(&Symbol::new(&env, "max_slippage"), &200i128);

// Early unstake penalty: 500 bps = 5%
registry_client.set_param(&Symbol::new(&env, "unstake_penalty"), &500i128);
```

### Reading parameters from another contract

```rust
// Hard fail if parameter must be set
let fee_bps: i128 = registry_client.get_param(&Symbol::new(&env, "protocol_fee"));

// Graceful fallback for optional parameters
let min_liq: i128 = registry_client.get_param_or_default(
    &Symbol::new(&env, "min_liquidity"),
    &1_000_000i128,
);
```

## Integration

Other protocol contracts should accept the registry address as a constructor or initialization parameter and call `get_param` / `get_param_or_default` to read configuration at runtime. This avoids hard-coding values and allows governance to tune the protocol without redeployment.

```rust
// In another contract's initialization
env.storage().instance().set(&DataKey::Registry, &registry_addr);

// In a fee calculation
let registry: Address = env.storage().instance().get(&DataKey::Registry).unwrap();
let fee_bps: i128 = ParameterRegistryClient::new(&env, &registry)
    .get_param_or_default(&Symbol::new(&env, "protocol_fee"), &30i128);
```

## Security Considerations

- **Governance key security**: The governance address should be a multisig or DAO contract, not an EOA, to prevent unilateral parameter changes.
- **Parameter validation**: Callers are responsible for validating parameter values are within acceptable ranges after reading them.
- **No upgrade path**: The registry itself is not upgradeable. Deploy a new registry and migrate governance if a breaking change is needed.
