# Webhook Batching Engine

The Webhook Batching Engine optimizes network throughput by grouping multiple events into a single array-based webhook request. This is particularly useful for high-frequency events where individual webhook deliveries would cause significant overhead.

## How it Works

When batching is enabled for a trigger, the system collects events over a specified time window or until a maximum batch size is reached. These events are then packaged into a single JSON payload and sent to the configured webhook URL.

### Batched Webhook Payload Format

A batched webhook payload has the following structure:

```json
{
  "contractId": "CBQ2J...",
  "eventName": "transfer",
  "isBatch": true,
  "batchSize": 3,
  "events": [
    {
      "payload": { "from": "GBX...", "to": "GDX...", "amount": "1000" },
      "index": 0,
      "timestamp": "2024-01-01T12:00:00.000Z"
    },
    {
      "payload": { "from": "GBY...", "to": "GDZ...", "amount": "2000" },
      "index": 1,
      "timestamp": "2024-01-01T12:00:01.000Z"
    },
    {
      "payload": { "from": "GBA...", "to": "GDB...", "amount": "3000" },
      "index": 2,
      "timestamp": "2024-01-01T12:00:02.000Z"
    }
  ]
}
```

### Signature Verification

The signature for a batched webhook is generated the same way as for a single webhook, but it covers the entire JSON string of the batched payload.

The signature is provided in the `X-EventHorizon-Signature` header, and the timestamp in the `X-EventHorizon-Timestamp` header.

## Configuration

Batching can be configured per trigger via the `batchingConfig` object:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | `false` | Whether batching is enabled for this trigger. |
| `windowMs` | number | `10000` | The time window (in milliseconds) to collect events before flushing. |
| `maxBatchSize` | number | `50` | The maximum number of events to include in a single batch. |
| `continueOnError` | boolean | `true` | (Non-webhook only) Whether to continue processing if one event fails. For webhooks, the entire batch succeeds or fails together. |

## Benefits

- **Reduced Latency:** Fewer HTTP handshakes and TCP overhead.
- **Lower Resource Usage:** Reduced CPU and memory usage on both EventHorizon and the consumer side.
- **Improved Reliability:** Easier to manage rate limits on the receiving end.
