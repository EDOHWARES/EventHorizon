# Observability: OpenTelemetry & Distributed Tracing

EventHorizon's backend ships with optional OpenTelemetry instrumentation that
covers the full request flow from the HTTP API through the BullMQ queue and
into the worker that executes trigger actions. This document describes how to
turn it on, how to point it at a collector, and what spans you can expect.

## Quick start

1. Install dependencies (already covered by `npm install --workspace=backend`).
2. Start a Jaeger backend for local development:

   ```bash
   docker compose --profile observability up -d jaeger
   ```

   Jaeger UI is then available at <http://localhost:16686>. The all-in-one
   image exposes both the OTLP/HTTP endpoint (port 4318) and the legacy Jaeger
   collector (port 14268).

3. Set environment variables in `backend/.env`:

   ```env
   OTEL_ENABLED=true
   OTEL_SERVICE_NAME=eventhorizon-backend
   OTEL_EXPORTER=otlp
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
   ```

4. Start the backend (`npm run dev --workspace=backend`). Hit any route, then
   open the Jaeger UI and search for the `eventhorizon-backend` service.

Tracing is **opt-in**: when `OTEL_ENABLED` is unset or `false`, the SDK never
starts and the helpers in `src/utils/tracing.js` fall back to the OpenTelemetry
no-op implementation. Production deployments see no behavioural or performance
difference until the flag is flipped.

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | Master switch. Must be `true` to start the SDK. |
| `OTEL_SERVICE_NAME` | `eventhorizon-backend` | Service name reported on every span. |
| `OTEL_SERVICE_VERSION` | `1.0.0` | Reported as `service.version`. |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `NODE_ENV` or `development` | Reported as `deployment.environment`. |
| `OTEL_EXPORTER` | `otlp` | One of `otlp`, `jaeger`, `console`, `none`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP/HTTP endpoint. |
| `OTEL_EXPORTER_JAEGER_ENDPOINT` | `http://localhost:14268/api/traces` | Used when `OTEL_EXPORTER=jaeger`. |

Choose `console` to spool spans to stdout while you debug. Choose `none` to
generate spans without exporting them (useful in tests).

## What gets traced

The SDK is initialised in `src/config/tracing.js` and uses
`@opentelemetry/auto-instrumentations-node`, which automatically captures:

- **HTTP server**: every Express request — one span per request, with status
  codes, methods, and routes.
- **HTTP client / axios**: outbound webhook deliveries, RPC calls, Slack /
  Discord / Telegram callbacks.
- **MongoDB**: every query issued through Mongoose.
- **Redis / ioredis**: BullMQ traffic.

On top of the auto-instrumentation, the backend adds these manual spans:

| Span name | Where | Useful attributes |
| --- | --- | --- |
| `stellar.poll.cycle` | `worker/poller.js#pollEvents` | `rpc.url`, `poll.active_triggers` |
| `stellar.poll.contract` | `worker/poller.js` (per contract) | `stellar.contract_id`, `stellar.trigger_count` |
| `worker.action.execute` | `worker/processor.js` | `job.id`, `job.attempt`, `action.type`, `action.contract_id`, `action.event_name`, `action.is_batch` |

Trace context is propagated across the BullMQ queue via a `_traceContext`
field added to job payloads in `worker/queue.js`. The worker extracts it and
runs the job in the producer's context, so a single trace spans both the
poller process and the worker process.

Every Express response includes an `x-trace-id` header (set by
`middleware/tracing.middleware.js`) so frontend logs and customer tickets can
be correlated to a specific trace.

## Adding new spans

Use the helpers from `src/utils/tracing.js` rather than touching
`@opentelemetry/api` directly:

```js
const { withSpan, setAttributes } = require('../utils/tracing');

await withSpan('my.feature.subsystem', async (span) => {
    setAttributes({ 'feature.input.size': inputs.length });
    return doExpensiveWork(inputs);
}, { 'feature.name': 'subsystem' });
```

`withSpan` records exceptions and marks the span as `ERROR` automatically; you
do not need to manage the span's lifecycle.

## Performance notes

- Auto-instrumentation cost is dominated by the HTTP and database hooks; on
  hot paths under heavy load you can disable specific instrumentations by
  modifying `getNodeAutoInstrumentations()` in `src/config/tracing.js`.
- The default OTLP exporter batches spans, so the per-request overhead is
  bounded by an in-memory queue.
- Disabling tracing (`OTEL_ENABLED=false`) returns the application to its
  original code paths — there is no residual instrumentation cost.

## Troubleshooting

- **No spans show up in Jaeger**: confirm the backend logs print
  `OpenTelemetry tracing enabled` at startup, and check that
  `OTEL_EXPORTER_OTLP_ENDPOINT` is reachable from inside the container.
- **`OpenTelemetry initialization failed`**: usually means an exporter package
  is missing. Re-run `npm install --workspace=backend`.
- **Trace gaps between API and worker**: ensure both processes have
  `OTEL_ENABLED=true` set; context propagation only works when both ends are
  instrumented.

## Related issue

This work was tracked in
[issue #252](https://github.com/EDOHWARES/EventHorizon/issues/252).
