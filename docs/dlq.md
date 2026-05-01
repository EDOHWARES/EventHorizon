# Dead Letter Queue (DLQ) Management

EventHorizon automatically captures failed action attempts in a dedicated **Dead Letter Queue** collection, enabling operators to inspect, re-drive, and purge failures without data loss.

## Overview

When a trigger action fails (after all retries are exhausted), the failure is persisted in the `failed_actions` MongoDB collection. Each entry stores:

| Field | Description |
|---|---|
| `triggerId` | Reference to the originating trigger |
| `triggerSnapshot` | Full trigger config at the time of failure |
| `eventPayload` | The Soroban event that triggered the action |
| `errorMessage` | The error that caused the failure |
| `attemptsMade` | Number of attempts before landing in DLQ |
| `status` | `pending` → `redriving` → `resolved` / `purged` |
| `jobId` | BullMQ job ID (if queue was used) |
| `createdAt` | Timestamp of failure |

## Status Lifecycle

```
pending  ──redrive──►  redriving  ──success──►  resolved
   │                       │
   │                    failure
   │                       │
   └──────────────────────►┘ (reset to pending)
   │
   └──purge──►  purged
```

## API Endpoints

All endpoints are under `/api/dlq`.

### GET `/api/dlq/stats`

Returns counts per status.

```json
{
  "success": true,
  "data": {
    "pending": 12,
    "redriving": 0,
    "resolved": 45,
    "purged": 3,
    "total": 60
  }
}
```

### GET `/api/dlq/entries`

List DLQ entries with optional filtering and pagination.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `pending`, `redriving`, `resolved`, `purged` |
| `triggerId` | string | Filter by trigger ObjectId |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Page size, max 200 (default: 50) |

### POST `/api/dlq/entries/:id/redrive`

Re-drive a single pending DLQ entry. The entry's action is re-enqueued via BullMQ and the status transitions to `resolved` on success.

Returns `409` if the entry is not in `pending` state.

### POST `/api/dlq/redrive-all`

Re-drive **all** pending entries. Optionally scope to a single trigger via `?triggerId=<id>`.

```json
{
  "success": true,
  "data": {
    "total": 5,
    "succeeded": 4,
    "failed": 1,
    "failures": [{ "id": "...", "error": "Connection refused" }]
  }
}
```

### POST `/api/dlq/purge`

Mark entries as `purged` (soft delete). Supports filtering by status, triggerId, and age.

**Request body:**

```json
{
  "status": "pending",
  "triggerId": "507f1f77bcf86cd799439011",
  "olderThanMs": 604800000
}
```

`olderThanMs` example: `604800000` = 7 days.

## Integration

Failures are automatically recorded by the event poller (`src/worker/poller.js`) whenever a trigger action throws after all retries. No manual instrumentation is required.

## Example: Retry All Failed Webhooks

```bash
# 1. Check how many are pending
curl http://localhost:5000/api/dlq/stats

# 2. Re-drive all pending entries
curl -X POST http://localhost:5000/api/dlq/redrive-all

# 3. Purge entries older than 7 days
curl -X POST http://localhost:5000/api/dlq/purge \
  -H "Content-Type: application/json" \
  -d '{"olderThanMs": 604800000}'
```
