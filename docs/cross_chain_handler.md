# Cross Chain Handler Contract

## Overview

The Cross Chain Handler contract implements logic to serialize and lock messages for cross-chain delivery between Stellar and Ethereum. It provides integration points for validators to attest to delivery and includes a stub implementation of the bridge listener.

## Features

- **Message Serialization**: Handles sending messages with nonce for replay protection.
- **Validator Attestation**: Allows validators to attest to message delivery.
- **Bridge Listener Stub**: Placeholder for listening to bridge events.
- **Event Emission**: Publishes standardized cross-chain message events.

## API

### `send_message(sender: Address, destination_chain: Symbol, destination_address: String, payload: Bytes) -> u64`
Sends a cross-chain message and returns the nonce.

### `get_nonce() -> u64`
Returns the current nonce.

## Events

- `CC_MSG`: Emitted on message send. Topics: `(CC_MSG, sender, destination_chain)`, Data: `CrossChainMsgEvent`

## Data Structures

```rust
pub struct CrossChainMsgEvent {
    pub nonce: u64,
    pub sender: Address,
    pub destination_chain: Symbol,
    pub destination_address: String,
    pub payload: Bytes,
}
```