# Load Testing with k6 and Grafana

This document covers the automated load testing suite for the EventHorizon backend, implemented with [k6](https://k6.io/) and visualised with Grafana + InfluxDB.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Quick Start](#quick-start)
4. [Test Scripts](#test-scripts)
5. [Performance Budget](#performance-budget)
6. [Grafana Dashboards](#grafana-dashboards)
7. [CI / PR Integration](#ci--pr-integration)
8. [Environment Variables](#environment-variables)
9. [Interpreting Results](#interpreting-results)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| k6 | ≥ 0.50 | `brew install k6` / [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation/) |
| Docker + Compose | ≥ 24 | [docs.docker.com](https://docs.docker.com/get-docker/) |
| EventHorizon backend | running | `npm run dev:backend` |

---

## Project Structure

```
load-tests/
├── docker-compose.yml              # InfluxDB + Grafana stack
├── grafana/
│   ├── dashboards/
│   │   └── k6-eventhorizon.json    # Pre-built Grafana dashboard
│   └── provisioning/
│       ├── datasources/
│       │   └── influxdb.yml        # Auto-wires InfluxDB datasource
│       └── dashboards/
│           └── k6.yml              # Dashboard provider config
└── k6/
    ├── config.js                   # Shared BASE_URL, credentials, payloads
    ├── thresholds.js               # Performance budget (PR gates)
    ├── smoke-test.js               # CI smoke test (10 VUs, 30 s)
    ├── stress-test.js              # Full stress test (5 000 VUs)
    ├── auth-load-test.js           # Auth endpoints only
    ├── triggers-load-test.js       # Triggers CRUD lifecycle
    └── queue-load-test.js          # Queue & batch endpoints
```

---

## Quick Start

### 1. Start the observability stack

```bash
docker compose -f load-tests/docker-compose.yml up -d
```

- **InfluxDB** → `http://localhost:8086`
- **Grafana**  → `http://localhost:3001` (admin / admin)

### 2. Start the backend

```bash
npm run dev:backend
```

### 3. Run the smoke test (sanity check)

```bash
k6 run load-tests/k6/smoke-test.js
```

### 4. Run the full stress test with live metrics

```bash
k6 run \
  --out influxdb=http://localhost:8086/k6 \
  load-tests/k6/stress-test.js
```

Open Grafana at `http://localhost:3001` → **k6 / EventHorizon k6 Load Tests** to watch metrics in real time.

---

## Test Scripts

### `smoke-test.js`

| Property | Value |
|----------|-------|
| VUs | 10 |
| Duration | 30 s |
| Purpose | CI gate – runs on every PR |

Covers: health check, login, trigger create/delete, queue stats.

```bash
k6 run load-tests/k6/smoke-test.js
```

---

### `stress-test.js`

| Property | Value |
|----------|-------|
| Peak VUs | 5 000 |
| Duration | ~5 min total |
| Purpose | Full API stress test |

Covers all endpoints: auth, triggers CRUD, queue, discovery.

```bash
k6 run --out influxdb=http://localhost:8086/k6 load-tests/k6/stress-test.js
```

Load profile:

```
30s  → ramp to 100 VUs   (warm-up)
1m   → ramp to 1 000 VUs
2m   → ramp to 5 000 VUs (peak)
1m   → sustain 5 000 VUs
30s  → ramp down to 0
```

---

### `auth-load-test.js`

Focuses on `POST /api/auth/login` and `POST /api/auth/refresh` throughput. Useful for validating rate-limiter behaviour.

```bash
k6 run load-tests/k6/auth-load-test.js
```

---

### `triggers-load-test.js`

Exercises the full trigger lifecycle: **create → list → update → versions → restore → delete**.

```bash
k6 run load-tests/k6/triggers-load-test.js
```

---

### `queue-load-test.js`

Exercises queue and batch endpoints. Accepts HTTP 503 as a valid response when Redis is not configured.

```bash
k6 run load-tests/k6/queue-load-test.js
```

---

## Performance Budget

The performance budget is defined in `load-tests/k6/thresholds.js` and is the single source of truth for PR gates.

| Metric | Budget | Notes |
|--------|--------|-------|
| `http_req_duration` p(95) | < 500 ms | 95th percentile response time |
| `http_req_duration` p(99) | < 1 000 ms | Tail latency cap |
| `http_req_duration` avg | < 200 ms | Average response time |
| `http_req_failed` | < 1 % | HTTP error rate |
| `auth_duration` p(95) | < 300 ms | Login / refresh latency |
| `trigger_duration` p(95) | < 500 ms | Trigger CRUD latency |
| `queue_duration` p(95) | < 400 ms | Queue read latency |
| `error_rate` | < 1 % | Custom error counter |

A PR that causes **any** threshold to be breached must not be merged until the regression is fixed.

### Test profiles

| Profile | Export | Use case |
|---------|--------|----------|
| `SMOKE_OPTIONS` | `thresholds.js` | CI on every PR |
| `SOAK_OPTIONS` | `thresholds.js` | Nightly – detect memory leaks |
| `SPIKE_OPTIONS` | `thresholds.js` | Validate burst resilience |

Import a profile in your script:

```js
import { SMOKE_OPTIONS } from './thresholds.js';
export const options = SMOKE_OPTIONS;
```

---

## Grafana Dashboards

The dashboard is auto-provisioned when the Docker stack starts. It includes:

| Panel | Description |
|-------|-------------|
| HTTP Request Rate | Requests per second over time |
| HTTP Request Duration | p95, p99, avg latency |
| Active Virtual Users | VU ramp profile |
| HTTP Error Rate | % of failed requests |
| Auth Duration p95 | Auth endpoint latency stat |
| Trigger Duration p95 | Trigger CRUD latency stat |
| Queue Duration p95 | Queue endpoint latency stat |
| Triggers Created | Total triggers created counter |

Navigate to `http://localhost:3001` → **Dashboards** → **k6** → **EventHorizon k6 Load Tests**.

---

## CI / PR Integration

Add the following step to your GitHub Actions workflow (`.github/workflows/ci.yml`):

```yaml
- name: Install k6
  run: |
    sudo gpg -k
    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
      --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
      | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update && sudo apt-get install k6

- name: Run smoke test
  env:
    BASE_URL: http://localhost:3000
  run: k6 run load-tests/k6/smoke-test.js
```

k6 exits with a non-zero code when any threshold is breached, which will fail the CI job automatically.

---

## Environment Variables

All scripts read configuration from environment variables passed via `-e`:

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Backend base URL |
| `TEST_EMAIL` | `loadtest@eventhorizon.dev` | Test user email |
| `TEST_PASSWORD` | `LoadTest@123` | Test user password |
| `ADMIN_TOKEN` | `test-admin-token` | Admin API token |

Example:

```bash
k6 run \
  -e BASE_URL=https://staging.eventhorizon.dev \
  -e TEST_EMAIL=ci@eventhorizon.dev \
  -e TEST_PASSWORD=SecurePass123 \
  load-tests/k6/stress-test.js
```

---

## Interpreting Results

k6 prints a summary at the end of each run. Key fields to check:

```
✓ http_req_duration............: avg=45ms  p(95)=120ms  p(99)=310ms
✓ http_req_failed..............: 0.12%
✓ error_rate...................: 0.12%
✓ trigger_duration.............: avg=80ms  p(95)=210ms
```

- A `✓` means the threshold passed; `✗` means it was breached.
- If any `✗` appears, investigate the failing endpoint before merging.
- Use the Grafana dashboard to correlate latency spikes with VU ramp stages.

---

## See Also

- [k6 documentation](https://k6.io/docs/)
- [BullMQ / Queue setup](../backend/QUEUE_SETUP.md)
- [Redis optional fallback](../backend/REDIS_OPTIONAL.md)
- [Service mesh](service-mesh.md)
