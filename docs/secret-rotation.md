# Secret Rotation Policy

EventHorizon supports automated rotation of credential secrets (API keys and tokens) to reduce the risk of long-lived credentials being compromised.

## How It Works

1. A **RotationPolicy** is attached to a `Credential` document and defines how often the secret should be rotated (`intervalHours`).
2. A scheduler runs every hour and calls `processDueRotations()`, which finds all policies whose `nextRotationAt` is in the past and rotates each credential.
3. Every rotation — manual or automated — writes an **AuditLog** entry with `resourceType: 'Credential'` and `operation: 'UPDATE'`.

## API Endpoints

All endpoints require a valid `Authorization: Bearer <token>` header.

### Manage a Rotation Policy

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/credentials/:id/rotation-policy` | Retrieve the policy for a credential |
| `POST` | `/api/credentials/:id/rotation-policy` | Create or update the policy |
| `DELETE` | `/api/credentials/:id/rotation-policy` | Remove the policy |

**POST body:**
```json
{
  "intervalHours": 24
}
```

`intervalHours` must be an integer ≥ 1. Common values:

| Value | Meaning |
|-------|---------|
| `24` | Daily |
| `168` | Weekly |
| `720` | Monthly |

### Manual Rotation

```
POST /api/credentials/:id/rotate
```

Immediately rotates the credential's `accessToken` (and `refreshToken` if present) and records an audit log entry.

**Response:**
```json
{
  "credentialId": "...",
  "rotatedAt": "2026-04-28T13:00:00.000Z"
}
```

### Trigger Due Rotations (Admin / Cron)

```
POST /api/credentials/rotate/process
```

Processes all credentials whose rotation policy is due. Intended for admin use or external cron triggers.

**Response:**
```json
{
  "processed": 3,
  "results": [
    { "policyId": "...", "credentialId": "...", "rotatedAt": "...", "status": "rotated" },
    { "policyId": "...", "status": "failed", "error": "Credential not found" }
  ]
}
```

## Audit Logging

Every rotation event is recorded in the `audit_logs` collection:

| Field | Value |
|-------|-------|
| `operation` | `UPDATE` |
| `resourceType` | `Credential` |
| `resourceId` | Credential `_id` |
| `changes.diff[0].field` | `accessToken` |

Token values are **never** stored in audit logs — only the string `[REDACTED]` is recorded.

## Scheduler

The rotation scheduler is started automatically when the server boots:

```js
// server.js — runs every hour
setInterval(() => processDueRotations(), 60 * 60 * 1000);
```

No additional configuration is required. To change the check frequency, update the interval in `src/server.js`.

## Data Model

```
RotationPolicy
  credentialId   ObjectId (ref: Credential)
  userId         ObjectId (ref: User)
  intervalHours  Number (min: 1)
  lastRotatedAt  Date | null
  nextRotationAt Date (indexed)
  enabled        Boolean (default: true)
```

## Security Considerations

- New secrets are generated with `crypto.randomBytes(32)` (256-bit entropy).
- Secrets are encrypted at rest using AES-256-GCM before being stored in MongoDB.
- Rotation policies are scoped to the owning user — users cannot rotate credentials they do not own.
- Disable a policy by deleting it; the credential itself is unaffected.
