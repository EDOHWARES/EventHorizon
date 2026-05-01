# Flash Loan Registry

The Flash Loan Registry is a central component of the EventHorizon protocol designed for global profit tracking and arbitrage analysis. It provides a standardized way for all flash loan providers within the protocol to log their activities and analyze the effectiveness of arbitrage operations.

## Features

- **Global Loan Logging**: Records every flash loan issued by authorized protocol providers.
- **Profit Tracking**: Aggregates total profit (bounties) returned to the protocol.
- **Arbitrage ROI Analysis**: Calculates and logs the Return on Investment (ROI) for each successful arbitrage transaction in basis points (bps).
- **Public Events**: Emits public events for every loan participation, enabling external analytical tools to index protocol performance.

## Contract Functions

### `init(admin: Address)`
Initializes the registry with an administrative address.

### `set_provider(provider: Address, authorized: bool)`
Authorizes or deauthorizes a flash loan provider contract. Only callable by the admin.

### `record_loan(provider: Address, borrower: Address, token: Address, amount: i128, profit: i128)`
Records a flash loan execution.
- `provider`: The address of the flash loan provider contract (must authorize the call).
- `borrower`: The address that received the flash loan.
- `token`: The token address that was borrowed.
- `amount`: The amount borrowed.
- `profit`: The profit/bounty returned to the provider.

### `get_stats() -> (u32, i128)`
Returns the global statistics:
- `total_loans`: Total number of flash loans recorded.
- `total_profit`: Cumulative profit earned by the protocol from flash loans.

## Events

- `loan_rec`: Emitted for every recorded loan.
- `roi_bps`: Emitted when a loan results in a positive profit, indicating the ROI in basis points.

## Integration

Flash loan providers should call `record_loan` at the end of their `loan` execution if a registry address is configured.

```rust
if let Some(registry_addr) = env.storage().instance().get::<_, Address>(&DataKey::Registry) {
    env.invoke_contract::<()>(
        &registry_addr,
        &Symbol::new(&env, "record_loan"),
        vec![
            &env,
            env.current_contract_address().into_val(&env),
            receiver.into_val(&env),
            token_addr.into_val(&env),
            amount.into_val(&env),
            profit.into_val(&env),
        ],
    );
}
```
