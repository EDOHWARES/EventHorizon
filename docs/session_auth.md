# Session Auth Contract

The `SessionAuth` contract provides secure on-chain session management for external DApps integrating with the EventHorizon platform. It allows callers to create time-bounded, privilege-scoped sessions and emits structured events for every lifecycle transition.

## Session Lifecycle

```
create_session()
      │
      ▼
  [Active] ──── validate_session() ──► true
      │
      ├── set_privileges()  ──► privilege_changed event
      │
      ├── revoke_session()  ──► revoked event  ──► [Removed]
      │
      └── timestamp >= expiry ──► expired event ──► [Removed]
```

1. **Created** – `create_session` stores a `SessionData` entry in persistent storage and emits a `created` event.
2. **Active** – `validate_session` returns `true`; `get_session` returns the data; `set_privileges` updates the privilege list.
3. **Expired** – On any access after `expiry`, the entry is lazily removed and an `expired` event is emitted.
4. **Revoked** – The owner calls `revoke_session`; the entry is immediately removed and a `revoked` event is emitted.

## Public Functions

### `create_session(caller: Address, duration: u64, privileges: Vec<Symbol>) -> BytesN<32>`

Creates a new session for `caller`.

| Parameter    | Type          | Description                                      |
|--------------|---------------|--------------------------------------------------|
| `caller`     | `Address`     | Session owner. `require_auth()` is enforced.     |
| `duration`   | `u64`         | Session lifetime in seconds from current ledger. |
| `privileges` | `Vec<Symbol>` | Arbitrary privilege labels for the session.      |

**Returns** a 32-byte session ID (`BytesN<32>`) derived from `sha256(prng_bytes)`.

**Errors** – panics if auth is not provided.

---

### `revoke_session(caller: Address, session_id: BytesN<32>)`

Immediately invalidates a session. Only the session owner may call this.

| Parameter    | Type          | Description                                  |
|--------------|---------------|----------------------------------------------|
| `caller`     | `Address`     | Must match `SessionData.owner`.              |
| `session_id` | `BytesN<32>`  | ID of the session to revoke.                 |

**Errors** – `SessionError::NotFound` (1) if session does not exist; `SessionError::Unauthorized` (3) if caller is not the owner.

---

### `validate_session(session_id: BytesN<32>) -> bool`

Returns `true` if the session exists and has not expired. Performs lazy cleanup on expired sessions (removes storage entry and emits `expired` event).

| Parameter    | Type         | Description              |
|--------------|--------------|--------------------------|
| `session_id` | `BytesN<32>` | ID of the session to check. |

**Returns** `false` for unknown or expired sessions; never panics.

---

### `get_session(session_id: BytesN<32>) -> SessionData`

Returns the full `SessionData` for an active session.

| Parameter    | Type         | Description                 |
|--------------|--------------|-----------------------------|
| `session_id` | `BytesN<32>` | ID of the session to fetch. |

**Returns** `SessionData { owner, expiry, privileges }`.

**Errors** – `SessionError::NotFound` (1) if not found; `SessionError::Expired` (2) if expired (also cleans up storage and emits `expired` event).

---

### `set_privileges(caller: Address, session_id: BytesN<32>, new_privileges: Vec<Symbol>)`

Replaces the privilege list on an active session. Only the session owner may call this.

| Parameter        | Type          | Description                              |
|------------------|---------------|------------------------------------------|
| `caller`         | `Address`     | Must match `SessionData.owner`.          |
| `session_id`     | `BytesN<32>`  | ID of the session to update.             |
| `new_privileges` | `Vec<Symbol>` | Replacement privilege list.              |

**Errors** – `SessionError::NotFound` (1), `SessionError::Unauthorized` (3), or `SessionError::Expired` (2).

## Data Structures

### `SessionData`

```rust
pub struct SessionData {
    pub owner:      Address,       // Session owner
    pub expiry:     u64,           // Unix timestamp after which session is invalid
    pub privileges: Vec<Symbol>,   // Caller-defined privilege labels
}
```

### `SessionError`

| Variant       | Value | Meaning                                  |
|---------------|-------|------------------------------------------|
| `NotFound`    | 1     | No session exists for the given ID.      |
| `Expired`     | 2     | Session exists but its expiry has passed.|
| `Unauthorized`| 3     | Caller is not the session owner.         |

## Events

All events use the topic prefix `"session"` as the first topic.

| Event               | Topics                          | Data                              |
|---------------------|---------------------------------|-----------------------------------|
| Session created     | `("session", "created")`        | `(session_id: BytesN<32>, owner: Address)` |
| Session expired     | `("session", "expired")`        | `session_id: BytesN<32>`          |
| Session revoked     | `("session", "revoked")`        | `(session_id: BytesN<32>, caller: Address)` |
| Privilege changed   | `("session", "privilege_changed")` | `(session_id: BytesN<32>, new_privileges: Vec<Symbol>)` |

## Storage Layout

| Key                        | Storage Type | Value        | Lifetime                          |
|----------------------------|--------------|--------------|-----------------------------------|
| `DataKey::Session(id)`     | `persistent` | `SessionData`| Until revoked or expiry cleanup   |

**Footprint considerations:**
- Only active sessions occupy storage. Expired sessions are removed lazily on the first access after expiry (via `validate_session` or `get_session`), keeping the ledger footprint minimal.
- Each session entry stores one `Address`, one `u64`, and a `Vec<Symbol>`. For typical privilege sets (2–5 symbols), this is well under 256 bytes per entry.
- No global counters or indexes are maintained; the contract is stateless beyond individual session entries.
