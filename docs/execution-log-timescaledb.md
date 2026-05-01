# Execution Log Persistence — TimescaleDB

## Overview

EventHorizon persists every trigger execution as a time-series row in **TimescaleDB**, a PostgreSQL extension optimised for time-series workloads. This enables:

- Long-term execution history with sub-second query latency
- Continuous aggregates for real-time trend dashboards
- Automatic data retention (configurable chunk expiry)
- Efficient range queries over millions of rows

MongoDB continues to store trigger configuration and aggregate counters (`totalExecutions`, `failedExecutions`). TimescaleDB stores the individual execution events.

---

## Architecture

```
Soroban RPC
    │
    ▼
poller.js ──► BullMQ queue ──► processor.js
    │                               │
    │ (direct fallback)             │
    └───────────────────────────────┤
                                    ▼
                        executionLog.service.js
                                    │
                                    ▼
                            TimescaleDB
                        (execution_logs hypertable)
```

Both execution paths (queue-backed and direct) write to TimescaleDB. Writes are **fire-and-forget** — a TimescaleDB outage never interrupts trigger execution.

---

## Database Schema

### `execution_logs` (hypertable, partitioned by `executed_at`, 1-day chunks)

| Column | Type | Description |
|---|---|---|
| `executed_at` | `TIMESTAMPTZ` | Partition key — when the execution occurred |
| `id` | `UUID` | Row identifier |
| `trigger_id` | `TEXT` | MongoDB ObjectId of the trigger |
| `organization_id` | `TEXT` | MongoDB ObjectId of the organisation |
| `network` | `TEXT` | `testnet` or `mainnet` |
| `contract_id` | `TEXT` | Soroban contract address |
| `event_name` | `TEXT` | Matched event name |
| `action_type` | `TEXT` | `webhook`, `discord`, `email`, `telegram` |
| `status` | `TEXT` | `success`, `failure`, `retrying` |
| `duration_ms` | `INTEGER` | Wall-clock execution time |
| `attempt_number` | `INTEGER` | Retry attempt (1 = first try) |
| `error_message` | `TEXT` | Error detail on failure |
| `error_code` | `TEXT` | Error code if available |
| `is_batch` | `BOOLEAN` | Whether this was a batch execution |
| `batch_size` | `INTEGER` | Total events in the batch |
| `batch_successful` | `INTEGER` | Successfully processed batch events |
| `batch_failed` | `INTEGER` | Failed batch events |
| `ledger_sequence` | `BIGINT` | Soroban ledger number |
| `payload_snapshot` | `JSONB` | Raw event payload (opt-in, see `TIMESCALE_STORE_PAYLOAD`) |
| `source` | `TEXT` | `queue`, `direct`, or `migration` |

### `execution_trends_hourly` (continuous aggregate)

Pre-aggregated hourly rollup used by the `/trends` API endpoint. Refreshed automatically every hour by TimescaleDB's background worker.

---

## Setup

### 1. Install TimescaleDB

Follow the [official installation guide](https://docs.timescale.com/self-hosted/latest/install/) or use the managed [Timescale Cloud](https://www.timescale.com/cloud) service.

### 2. Configure environment variables

Add to your `.env` (see `.env.example` for all options):

```env
TIMESCALE_URL=postgresql://postgres:password@localhost:5432/eventhorizon_ts
TIMESCALE_SSL=false
TIMESCALE_RETENTION_DAYS=90
TIMESCALE_STORE_PAYLOAD=false
```

### 3. Run the DDL setup script

```bash
npm run timescale:setup
```

This creates the `execution_logs` hypertable, indexes, continuous aggregate, and retention policy. Safe to re-run.

### 4. (Optional) Migrate historical data from MongoDB

```bash
# Dry run — shows what would be inserted without writing
npm run timescale:migrate:dry

# Live migration
npm run timescale:migrate
```

The migration script synthesises daily summary rows from the aggregate counters stored in MongoDB triggers. It does not require individual event history to exist.

---

## API Reference

All endpoints require a valid JWT (`Authorization: Bearer <token>`).

### `GET /api/execution-logs/triggers/:triggerId`

Returns paginated execution history for a trigger.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Max rows (capped at 500) |
| `offset` | integer | 0 | Pagination offset |
| `status` | string | — | Filter: `success`, `failure`, `retrying` |
| `from` | ISO 8601 | — | Start of time range |
| `to` | ISO 8601 | — | End of time range |

**Example response:**

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        "executed_at": "2024-01-15T14:32:00Z",
        "status": "success",
        "duration_ms": 142,
        "attempt_number": 1,
        "action_type": "webhook",
        "ledger_sequence": 1234567
      }
    ],
    "pagination": { "total": 1, "limit": 50, "offset": 0, "hasMore": false }
  }
}
```

---

### `GET /api/execution-logs/trends`

Returns time-bucketed execution counts for the authenticated organisation.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `triggerId` | string | — | Narrow to a single trigger |
| `network` | string | — | Filter by network |
| `from` | ISO 8601 | 24 h ago | Start of window |
| `to` | ISO 8601 | now | End of window |
| `interval` | string | `1 hour` | Bucket size: `1 minute`, `5 minutes`, `15 minutes`, `1 hour`, `6 hours`, `1 day` |

**Example response:**

```json
{
  "success": true,
  "data": {
    "interval": "1 hour",
    "from": "2024-01-15T00:00:00Z",
    "to": "2024-01-16T00:00:00Z",
    "buckets": [
      {
        "bucket": "2024-01-15T14:00:00Z",
        "trigger_id": "507f1f77bcf86cd799439011",
        "action_type": "webhook",
        "status": "success",
        "total_executions": "12",
        "avg_duration_ms": "138",
        "successful": "12",
        "failed": "0"
      }
    ]
  }
}
```

---

### `GET /api/execution-logs/triggers/:triggerId/health`

Returns success rate and average duration over a rolling time window.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `windowHours` | integer | 24 | Look-back window in hours (max 720) |

**Example response:**

```json
{
  "success": true,
  "data": {
    "triggerId": "507f1f77bcf86cd799439011",
    "windowHours": 24,
    "total": 48,
    "successful": 46,
    "failed": 2,
    "successRate": 96,
    "avgDurationMs": 145
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TIMESCALE_URL` | — | PostgreSQL connection string (required to enable) |
| `TIMESCALE_SSL` | `false` | Enable SSL for the pg connection |
| `TIMESCALE_POOL_MAX` | `10` | Max connections in the pool |
| `TIMESCALE_RETENTION_DAYS` | `90` | Chunks older than this are automatically dropped |
| `TIMESCALE_STORE_PAYLOAD` | `false` | Store raw event payload in `payload_snapshot` column |

---

## Performance Notes

- The hypertable uses **1-day chunks** — each day's data is a separate PostgreSQL table, enabling fast range scans and efficient chunk exclusion.
- The `execution_trends_hourly` **continuous aggregate** pre-computes hourly rollups so trend queries never scan raw rows.
- Indexes on `(trigger_id, executed_at DESC)` and `(organization_id, executed_at DESC)` cover the most common access patterns.
- The retention policy automatically drops old chunks without locking the table.
- Writes are batched at the application level via fire-and-forget async calls, adding zero latency to trigger execution.
