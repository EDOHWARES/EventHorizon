# Developer Royalty Registry

The `DeveloperRoyaltyRegistry` contract is a core finance component of the EventHorizon platform. It automates payments to middleware developers for every trigger fired and supports complex, hierarchical royalty splits.

## Features

- **Service Registration**: Developers can register their middleware services with a fixed fee and a split configuration.
- **Hierarchical Splits**: Revenue can be shared between multiple addresses and even other registered services.
- **Automated Settlement**: The platform's settler account can trigger royalty distribution for one or multiple executions of a service.
- **On-chain Audit**: Emits events for every registration, update, settlement, and individual revenue share.

## Contract Interface

### `initialize(admin: Address, settler: Address, token: Address)`
Initializes the contract with the administrative account, the authorized settler (platform worker), and the token used for payments (e.g., XLM or a stablecoin).

### `register_service(owner: Address, fee: i128, splits: Vec<RoyaltySplit>) -> u64`
Registers a new service. Returns a unique `service_id`.
- `owner`: The address that owns the service and can update it.
- `fee`: The fee in tokens per execution.
- `splits`: A list of `RoyaltySplit` objects.

### `update_service(service_id: u64, fee: i128, splits: Vec<RoyaltySplit>)`
Allows the service owner to update the fee and split configuration.

### `settle_royalty(service_id: u64, executions: u32)`
Triggers the distribution of royalties.
- Only callable by the `Settler`.
- Transfers tokens from the `Settler`'s account to the beneficiaries defined in the splits.
- Supports recursive distribution for hierarchical splits.

### `get_service(service_id: u64) -> Service`
Returns the metadata and configuration for a service.

## Data Structures

### `RoyaltySplit`
```rust
struct RoyaltySplit {
    recipient: Recipient,
    bps: u32, // Basis points (10000 = 100%)
}
```

### `Recipient`
```rust
enum Recipient {
    Address(Address),
    Service(u64), // Points to another service ID for hierarchical splits
}
```

## Events

- `reg_serv(id, owner, fee)`: Emitted on service registration.
- `upd_serv(id, owner, fee)`: Emitted on service update.
- `settled(id, total_amount)`: Emitted when a batch of executions is settled.
- `rev_share(id, recipient, amount)`: Emitted for every individual payment distributed.

## Hierarchical Splits Example

If **Service A** has a split of 50% to **Address 1** and 50% to **Service B**.
When **Service A** is settled for 100 tokens:
1. **Address 1** receives 50 tokens.
2. The remaining 50 tokens are distributed according to **Service B**'s own split configuration.

This allows for collaborative middleware development where multiple developers or organizations can share revenue proportionally.
