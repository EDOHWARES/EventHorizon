# RWA Registry — On-chain Registry for Trusted Metadata and Hash Anchors

The `RwaRegistry` contract provides immutable on-chain anchoring of document hashes linked to Real-World Assets (RWA). It enables trustless verification of off-chain documents and supports multi-signature governance for updating mutable metadata.

## Features

- **Immutable Hash Anchoring**: Document hashes are written once and can never be overwritten or deleted.
- **Duplicate Prevention**: The same hash cannot be anchored twice; a reverse-lookup index enforces uniqueness.
- **Multi-sig Metadata Updates**: Mutable fields (metadata, verification status) can only be changed via a threshold-of-N approval flow.
- **Admin Verification**: The admin can directly set the `verified` flag on any document without going through multi-sig.
- **On-chain Events**: Every anchor, proposal, approval, update, and verification emits a structured event for EventHorizon workers to consume.

## Contract Interface

### `initialize(admin, signers, threshold)`
One-time setup. Must be called before any other function.
- `admin`: Address of the security committee / admin.
- `signers`: `Vec<Address>` forming the multi-sig committee.
- `threshold`: Minimum number of signer approvals required to execute a metadata update (`1 ≤ threshold ≤ len(signers)`).

### `anchor(owner, hash, label, metadata) -> u64`
Anchors a new document hash on-chain. Returns the assigned document ID.
- `owner`: Address that owns the document (must sign the transaction).
- `hash`: Raw bytes of the document hash (e.g., SHA-256). Must be non-empty and unique.
- `label`: Human-readable identifier (IPFS CID, URI, or name).
- `metadata`: Initial mutable metadata string.
- Panics if `hash` is empty or already anchored.

### `propose_update(proposer, doc_id, new_metadata, new_verified) -> u64`
Any signer can propose updating the mutable fields of an existing document. Returns the proposal ID.
- Panics if `proposer` is not in the signers list or the document does not exist.

### `approve_update(signer, proposal_id)`
A signer approves a pending update proposal. Once the approval count reaches `threshold`, the update is executed automatically.
- Panics if the signer has already approved this proposal or the proposal is already executed.

### `admin_verify(admin, doc_id, verified)`
Admin shortcut to set the `verified` flag directly, bypassing multi-sig.
- Panics if `admin` does not match the stored admin address.

### `get_doc(doc_id) -> DocRecord`
Returns the full document record for a given ID.

### `get_doc_by_hash(hash) -> DocRecord`
Reverse lookup: returns the document record for a given hash.

### `is_anchored(hash) -> bool`
Returns `true` if the hash has been anchored.

### `get_proposal(proposal_id) -> UpdateProposal`
Returns the update proposal for a given ID.

### `get_signers() -> Vec<Address>`
Returns the current list of multi-sig signers.

### `get_threshold() -> u32`
Returns the current approval threshold.

## Data Structures

### `DocRecord`
```rust
struct DocRecord {
    hash: Bytes,        // Immutable – SHA-256 or similar
    label: String,      // Immutable – IPFS CID / URI / name
    owner: Address,     // Immutable – original anchoring address
    anchored_at: u64,   // Immutable – ledger timestamp
    metadata: String,   // Mutable via multi-sig
    verified: bool,     // Mutable via multi-sig or admin
}
```

### `UpdateProposal`
```rust
struct UpdateProposal {
    doc_id: u64,
    new_metadata: String,
    new_verified: bool,
    approvals: u32,
    executed: bool,
}
```

## Events

| Topic | Data | Description |
|-------|------|-------------|
| `("anchored", doc_id)` | `hash` | New document anchored |
| `("prop_new", proposal_id)` | `(doc_id, proposer)` | Update proposal created |
| `("approved", proposal_id)` | `(signer, approvals)` | Signer approved a proposal |
| `("updated", doc_id)` | `(new_metadata, new_verified)` | Proposal executed, document updated |
| `("verified", doc_id)` | `verified` | Admin set verification status |

## Storage Layout

| Key | Storage Type | Description |
|-----|-------------|-------------|
| `Admin` | Instance | Admin address |
| `Signers` | Instance | Multi-sig signer list |
| `Threshold` | Instance | Approval threshold |
| `NextDocId` | Instance | Monotonic document counter |
| `NextProposalId` | Instance | Monotonic proposal counter |
| `Doc(id)` | Persistent | Document record |
| `DocHash(hash)` | Persistent | Reverse hash → doc_id index |
| `Proposal(id)` | Persistent | Update proposal |
| `Approval(proposal_id, signer)` | Temporary | Per-signer approval flag |

## Integration with EventHorizon

EventHorizon workers can subscribe to the following events emitted by this contract:

- **`anchored`** – trigger downstream workflows when a new RWA document is registered.
- **`verified`** / **`updated`** – trigger notifications or compliance checks when document status changes.

Configure a trigger in the EventHorizon dashboard with the deployed contract ID and the event name (e.g., `anchored`).

## Security Considerations

- The `hash` field is written once and is never modified, ensuring tamper-evident anchoring.
- Metadata updates require multi-sig approval, preventing unilateral changes.
- The `Approval` flag uses **temporary storage**, which expires after the ledger TTL. Proposals should be executed before the TTL window closes.
- The admin `admin_verify` function is a privileged escape hatch; restrict the admin key accordingly.
