# ABI Registry

The **ABI Registry** is an on-chain Soroban smart contract that provides storage for Soroban contract ABI and metadata, enabling automatic discovery and versioning for the EventHorizon platform.

## Overview

The ABI Registry addresses the need for robust tooling in the Stellar Soroban ecosystem by providing:

- **Storage for Soroban IDL and metadata** - Store contract ABIs on-chain for automatic discovery
- **ABI update and versioning events** - Track changes with emitted events
- **High-throughput metadata fetching** - Optimized for efficient metadata retrieval
- **Contract verification** - Mark contracts as verified for trust

## Features

### Contract Registration
Register Soroban contracts with metadata including:
- Contract address (ID)
- Human-readable name
- Description
- ABI/IDL data
- Version notes

### Version Management
- Automatic version incrementing on ABI updates
- Version history tracking (up to 100 versions retained)
- Rollback capability to previous versions
- ABI hash for change detection

### Automatic Discovery
- Lookup contracts by name
- List all verified contracts
- Check registration status

### Verification System
- Mark contracts as verified
- Track verified contracts in an index
- Emit verification events

## Contract Interface

### `initialize(admin: Address)`
Initializes the registry with an admin address. Can only be called once.

### `register(contract_id: Address, name: String, description: String, abi_data: Vec<u8>, note: String) -> u32`
Registers a new contract with ABI metadata. Returns the initial version number (1).

### `update(contract_id: Address, abi_data: Vec<u8>, note: String) -> u32`
Updates the ABI for an existing contract. Returns the new version number.

### `rollback(contract_id: Address, target_version: u32) -> bool`
Rollbacks to a previous ABI version.

### `verify(contract_id: Address) -> bool`
Marks a contract as verified.

### `remove(contract_id: Address) -> bool`
Removes a contract from the registry.

### `get_metadata(contract_id: Address) -> ContractAbiMetadata`
Returns contract metadata (without full ABI for efficiency).

### `get_abi(contract_id: Address) -> Vec<u8>`
Returns the ABI data for a contract (optimized for high-throughput).

### `get_version_history(contract_id: Address) -> Vec<AbiVersion>`
Returns the version history for a contract.

### `get_by_name(name: String) -> Option<Address>`
Lookup contract address by name.

### `get_verified_contracts() -> Vec<Address>`
Returns all verified contract addresses.

### `is_registered(contract_id: Address) -> bool`
Check if a contract is registered.

## Data Structures

### `ContractAbiMetadata`
```rust
struct ContractAbiMetadata {
    pub contract_id: Address,
    pub name: String,
    pub description: String,
    pub version: u32,
    pub abi_data: Vec<u8>,
    pub abi_hash: [u8; 32],
    pub verified: bool,
    pub added_at: u64,
    pub updated_at: u64,
    pub version_history: Vec<AbiVersion>,
}
```

### `AbiVersion`
```rust
struct AbiVersion {
    pub version: u32,
    pub abi_hash: [u8; 32],
    pub created_at: u64,
    pub note: String,
}
```

## Events

| Event | Topics | Data |
|-------|--------|------|
| `reg` | contract_id, name | version |
| `upd` | contract_id | (new_version, abi_hash) |
| `rbk` | contract_id | target_version |
| `ver` | contract_id | () |
| `rem` | contract_id | () |

## Usage with Backend Service

The backend provides an `AbiRegistryService` for interacting with the on-chain contract:

```javascript
const AbiRegistryService = require('./services/abi-registry.service');

const abiService = new AbiRegistryService(
    'https://soroban-testnet.stellar.org',
    'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'
);

// Register a contract
const version = await abiService.registerContract(
    'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0',
    'MyContract',
    'A sample Soroban contract',
    abiBuffer,
    'Initial version'
);

// Get metadata (optimized for high-throughput)
const metadata = await abiService.getMetadata(contractId);

// Get ABI data
const abi = await abiService.getAbi(contractId);

// Lookup by name
const contractAddress = await abiService.getByName('MyContract');

// Verify a contract
await abiService.verifyContract(contractId);
```

## Performance Considerations

### Caching
The backend service implements an in-memory LRU-like cache:
- Default cache size: 100 entries
- Caches both ABI data and metadata
- Automatic cache trimming when full

### Optimized Queries
- `get_metadata()` returns metadata without full ABI for efficiency
- `get_abi()` provides direct ABI access for high-throughput scenarios
- Separate storage for large ABI data from metadata

### Storage Limits
- Maximum ABI size: 64KB
- Maximum version history: 100 versions (oldest removed when exceeded)

## Integration with EventHorizon

The ABI Registry integrates with EventHorizon's trigger system:

1. **Event Detection**: Workers poll for contract events
2. **ABI Lookup**: When a new contract is detected, query its ABI from the registry
3. **Event Parsing**: Use the ABI to decode event data
4. **Action Execution**: Trigger webhooks or other actions

### Example: Auto-discover contract events

```javascript
// When a new contract emits events, automatically discover its ABI
const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

// Check if registered
const isRegistered = await abiService.isRegistered(contractId);

if (isRegistered) {
    const metadata = await abiService.getMetadata(contractId);
    const abi = await abiService.getAbi(contractId);
    
    console.log(`Contract: ${metadata.name}`);
    console.log(`Version: ${metadata.version}`);
    console.log(`Verified: ${metadata.verified}`);
}
```

## Security Considerations

- **Admin-only initialization**: The contract must be initialized by an admin
- **No authentication on reads**: Public read access for transparency
- **Event verification**: Clients should verify events match on-chain state
- **ABI hash validation**: Verify ABI integrity using stored hashes

## Testing

Run the contract tests:
```bash
cd contracts/abi_registry
cargo test
```

Run the backend service tests:
```bash
cd backend
npm test -- __tests__/abi-registry.service.test.js
```

## Deployment

1. **Build the contract**:
   ```bash
   cd contracts/abi_registry
   cargo build --release
   ```

2. **Deploy to Soroban network**:
   ```bash
   soroban contract deploy --wasm target/release/abi_registry.wasm
   ```

3. **Initialize the contract**:
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --initialize \
     --admin <ADMIN_ADDRESS>
   ```

4. **Configure backend**:
   Set the `ABI_REGISTRY_CONTRACT_ADDRESS` environment variable in your backend configuration.