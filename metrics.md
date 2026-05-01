# Prometheus Metrics Exporter

EventHorizon backend includes a Prometheus exporter to monitor the health and performance of the protocol, tracking action rates, system resources, and queue latencies.

## Endpoint
The metrics are exposed over HTTP on port `9090` (default) at the `/metrics` endpoint.

## Available Metrics

### Default Node.js Metrics
CPU and Memory usage are automatically collected using the `prom-client` default metrics suite. This includes metrics like:
- `process_cpu_user_seconds_total`
- `process_cpu_system_seconds_total`
- `nodejs_heap_size_total_bytes`
- `nodejs_heap_size_used_bytes`

### Custom Action Metrics

#### `eventhorizon_action_status_total` (Counter)
Tracks the total number of actions processed by the backend. It includes two labels:
- `status`: `success` or `failure`.
- `action_type`: The type of action that was executed.

#### `eventhorizon_queue_latency_seconds` (Histogram)
Monitors the latency of actions as they wait in the queue before being processed.