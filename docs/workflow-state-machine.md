# Workflow State Machine

## Overview

EventHorizon uses an **XState v5** server-side state machine to model the lifecycle of every trigger execution. Each time a Soroban contract event matches a configured trigger, a workflow actor is spawned, progresses through defined stages, and its state is persisted to MongoDB for dashboard visibility.

---

## State Diagram

```
┌──────────┐   START    ┌────────────┐   valid    ┌─────────┐
│   idle   │──────────▶ │ validating │──────────▶ │ pending │
└──────────┘            └────────────┘            └────┬────┘
                              │ invalid                 │ EVENT_RECEIVED
                              ▼                         ▼
                         ┌────────┐             ┌───────────┐
                         │ failed │◀──────────── │ executing │
                         └────────┘   retries    └─────┬─────┘
                              ▲       exhausted        │ success
                              │                         ▼
                         CANCEL from             ┌───────────┐
                         pending ────────────────│ completed │
                                                 └───────────┘
                                   retrying
                         executing ──────────▶ retrying ──▶ executing
```

### States

| State | Description |
|---|---|
| `idle` | Machine instantiated; awaiting `START` event |
| `validating` | Schema & guard checks run asynchronously |
| `pending` | Validation passed; awaiting `EVENT_RECEIVED` from the Soroban poller |
| `executing` | Action (webhook / Discord / email / Telegram) is in flight |
| `retrying` | Exponential back-off before re-attempting the action |
| `completed` | Action succeeded — terminal state |
| `failed` | Unrecoverable failure or explicit `CANCEL` — terminal state |

---

## Files Added

| Path | Purpose |
|---|---|
| `src/services/workflowMachine.js` | XState machine definition, `validateWorkflowContext`, `retryDelay` |
| `src/services/workflow.service.js` | Actor lifecycle manager; persists snapshots to MongoDB |
| `src/models/workflowExecution.model.js` | Mongoose schema for persisted execution snapshots |
| `src/controllers/workflow.controller.js` | Express request handlers |
| `src/routes/workflow.routes.js` | Route definitions with OpenAPI JSDoc |
| `tests/unit/workflowMachine.test.js` | 19 unit tests (Node built-in test runner) |
| `tests/integration/workflow.service.test.js` | 8 integration tests with stubbed MongoDB |

---

## Wiring into app.js

Add this line to `src/app.js` alongside the other route registrations:

```js
app.use('/api/workflows', require('./routes/workflow.routes'));
```

---

## Dependency

XState v5 is required. Add it to `backend/package.json`:

```bash
npm install xstate@5
```

---

## REST API

### Start a workflow
```
POST /api/workflows
Authorization: Bearer <token>

{
  "triggerId": "<mongoId>",
  "eventPayload": { "ledger": 12345, "data": "..." }
}
```

### Get current state
```
GET /api/workflows/:workflowId
```

### Get execution history for a trigger
```
GET /api/workflows/trigger/:triggerId?limit=20&skip=0
```

### Deliver event to a pending workflow
```
POST /api/workflows/:workflowId/event
```

### Cancel a pending workflow
```
DELETE /api/workflows/:workflowId
```

---

## Retry Back-off

Failed action attempts are retried with exponential back-off, capped at 30 seconds:

```
delay = min(2^retryCount × 1000ms, 30000ms)
```

| Attempt | Delay |
|---|---|
| 1st retry | 1 s |
| 2nd retry | 2 s |
| 3rd retry | 4 s |
| 4th retry | 8 s |
| 5th+ retry | 30 s (cap) |

`maxRetries` is inherited from `trigger.retryConfig.maxRetries` (default: 3).

---

## Context Shape

```ts
{
  triggerId: string;        // Mongoose ObjectId of owning Trigger
  workflowId: string;       // Unique execution ID
  eventPayload: object;     // Raw Soroban event data
  actionType: 'webhook' | 'discord' | 'email' | 'telegram';
  actionUrl: string;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  validationErrors: string[];
}
```

---

## Running Tests

```bash
# Unit tests (no DB required)
node --test tests/unit/workflowMachine.test.js

# Integration tests (MongoDB stubbed)
node --test tests/integration/workflow.service.test.js

# All tests
node --test
```