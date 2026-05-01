# LiquifactEscrow Wasm Operations

Runbook for detecting a new LiquifactEscrow wasm deployment and triggering a
contract list refresh in the EventHorizon backend.

---

## How to detect a new wasm version on-chain

The LiquifactEscrow contract exposes a view function `schema_version()` that
returns a `u32` integer stored in persistent storage. This integer is the
**SCHEMA_VERSION** and is incremented with every breaking wasm upgrade.

The backend maintains a local registry in `src/config/escrowVersions.js` that
maps each known SCHEMA_VERSION to its corresponding semver string:

```js
const VERSION_REGISTRY = {
  '1.0.0': 1,
  '1.1.0': 2,
  '2.0.0': 3,
};
```

A new deployment is detected when the on-chain `schema_version()` return value
is **greater than** the highest value in `VERSION_REGISTRY`.

### Detection logic

`checkOnChainVersion()` in `src/config/escrowVersions.js`:

1. Calls `schema_version()` via `simulateTransaction` (read-only, no fee).
2. Compares the result against `latestKnownSchemaVersion()`.
3. Returns `{ onChainVersion, semver, isLatest, latestKnown }`.

---

## Step-by-step: triggering a contract list refresh after a new wasm deployment

1. **Deploy the new wasm** using the Soroban CLI or your CI pipeline.
   Confirm the new `SCHEMA_VERSION` is stored on-chain.

2. **Update the registry** in `src/config/escrowVersions.js`:
   ```js
   '3.0.0': 4,   // add the new entry
   ```
   Commit and deploy the backend.

3. **Trigger the refresh** via the admin endpoint:
   ```bash
   curl -X POST https://your-api/api/escrow/refresh \
     -H "X-Admin-Token: $ADMIN_ACCESS_TOKEN"
   ```
   The endpoint reads the on-chain version, compares it to the registry, and
   sets `refreshTriggered: true` when a newer version is detected.

4. **Verify the response**:
   ```json
   {
     "success": true,
     "data": {
       "onChainVersion": 4,
       "semver": "3.0.0",
       "isLatest": true,
       "latestKnown": 4,
       "refreshTriggered": false
     }
   }
   ```
   `refreshTriggered: true` means the on-chain version was ahead of the
   registry at the time of the call (i.e., the registry had not yet been
   updated).

5. **Downstream action** (extension point in `escrow.routes.js`): when
   `refreshTriggered` is `true`, the route logs the event. Wire in your own
   job enqueue or event emission at that point.

---

## Required environment variables

| Variable | Purpose |
|---|---|
| `LIQUIFACT_ESCROW_CONTRACT_ID` | Soroban contract address of the deployed LiquifactEscrow |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint (defaults to testnet if unset) |
| `NETWORK_PASSPHRASE` | Stellar network passphrase |
| `ADMIN_ACCESS_TOKEN` | Secret token required in `X-Admin-Token` header for admin endpoints |

---

## Admin endpoint reference

### `POST /api/escrow/refresh`

Reads the on-chain `SCHEMA_VERSION`, compares it to the local registry, and
returns whether a refresh was triggered.

**Auth**: `X-Admin-Token: <ADMIN_ACCESS_TOKEN>` header required.

**Success response (200)**:
```json
{
  "success": true,
  "data": {
    "onChainVersion": 3,
    "semver": "2.0.0",
    "isLatest": true,
    "latestKnown": 3,
    "refreshTriggered": false
  }
}
```

**Error responses**:

| Status | Condition |
|---|---|
| 401 | `X-Admin-Token` header missing |
| 403 | `X-Admin-Token` value does not match `ADMIN_ACCESS_TOKEN` |
| 500 | RPC call failed or contract returned an error |
| 503 | `ADMIN_ACCESS_TOKEN` is not set on the server |

**curl example**:
```bash
curl -s -X POST https://your-api/api/escrow/refresh \
  -H "X-Admin-Token: $ADMIN_ACCESS_TOKEN" | jq .
```

**OpenAPI**: the endpoint is annotated with `@openapi` JSDoc and appears in
the Swagger UI at `/api/docs`.

---

## Error handling expectations

- `checkOnChainVersion()` never calls `process.exit`. All errors are thrown
  as `Error` instances and propagate to the caller.
- The route handler catches all errors and returns a structured `500` JSON
  response; it never crashes the process.
- If `LIQUIFACT_ESCROW_CONTRACT_ID` is unset, `checkOnChainVersion()` throws
  immediately with a descriptive message before making any network call.
- RPC timeouts and simulation errors surface as `500` responses with the
  original error message in `data.error`.

### Rollback steps if refresh fails

1. Check the `500` response body for the error message.
2. Verify `LIQUIFACT_ESCROW_CONTRACT_ID` and `SOROBAN_RPC_URL` are correct.
3. Confirm the contract is reachable: `soroban contract invoke --id $CONTRACT_ID -- schema_version`.
4. If the registry is out of date (new wasm deployed but registry not updated),
   add the new entry to `VERSION_REGISTRY` and redeploy the backend.
5. Re-trigger the refresh endpoint once the backend is updated.

---

## Storage layout and footprint

The backend stores **no on-chain state**. All version data lives in:

- `src/config/escrowVersions.js` — in-process registry (zero DB footprint).
- Application logs — version check results are logged at `info` level.

The `simulateTransaction` call used to read `schema_version()` is read-only
and does not consume any ledger entries or fees.

---

## Security notes

- **Input validation**: `LIQUIFACT_ESCROW_CONTRACT_ID` is passed directly to
  the Stellar SDK `Contract` constructor. The SDK validates the address format;
  invalid addresses throw before any network call is made.
- **Auth requirements**: the `/api/escrow/refresh` endpoint requires a
  matching `X-Admin-Token` header. Use a long, randomly generated value for
  `ADMIN_ACCESS_TOKEN` and restrict the endpoint to internal networks or VPN.
- **Key handling**: no private keys are used. The version check uses
  `simulateTransaction` (read-only). No signing keys are required or stored.
- **No secrets in code**: all sensitive values (`ADMIN_ACCESS_TOKEN`,
  `LIQUIFACT_ESCROW_CONTRACT_ID`) are read exclusively from `process.env`.
  Never hardcode them in source files.
