# Poller Service Discovery and Orchestration

This document describes the Poller Service Discovery and Orchestration logic for the EventHorizon backend.

## Overview

- **Service Discovery:** Uses Consul for poller registration, health checks, and discovery.
- **Orchestration:** Poller assignment is automated based on reported load and health status.
- **Health-aware Routing:** Only healthy pollers are considered for event assignment.

## Endpoints

- `POST /api/discovery/assign-poller` — Assigns a poller for an event request based on load and health.

## Implementation Details

- Each poller registers itself with Consul and reports its load.
- The orchestrator queries Consul for healthy pollers and their loads, then assigns the event to the least-loaded healthy poller.
- Health checks are performed via HTTP endpoints exposed by each poller.

## Example Usage

```
POST /api/discovery/assign-poller
{
  "eventType": "Deposit",
  "network": "testnet"
}
```

Response:
```
{
  "success": true,
  "poller": {
    "ServiceID": "poller-host-12345",
    ...
  }
}
```

## Testing

- Unit and integration tests are provided for poller assignment and discovery logic.

## Performance

- Poller assignment is O(n) with respect to the number of pollers.
- Consul KV is used for lightweight load reporting.

---

See also: [service-mesh.md](service-mesh.md)
