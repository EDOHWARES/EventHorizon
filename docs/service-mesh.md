# EventHorizon Service Mesh Sidecar Proxy Architecture

## Overview
This update introduces a sidecar proxy architecture using Envoy for the backend, enabling mTLS, traffic shaping, and circuit breaking for improved scalability and security.

## How It Works
- **Envoy Proxy** runs as a sidecar container alongside the backend.
- **mTLS** is enforced between Envoy and the backend for secure internal communication.
- **Traffic shaping** and **circuit breaking** are configured in `envoy/envoy.yaml`.

## Running Locally
1. Build and start the stack:
   ```bash
   docker-compose up --build
   ```
2. Envoy listens on port 8080 and proxies to the backend over mTLS.

## Certificates
- Self-signed certs are generated at build time for demo purposes.
- See `backend/scripts/generate-certs.sh` for details.

## Benchmarks
- Use tools like `wrk` or `ab` to benchmark via Envoy (port 8080).
- Example:
  ```bash
  wrk -t4 -c100 -d30s https://localhost:8080/api/health
  ```

## References
- [Stellar Soroban Docs](https://soroban.stellar.org/docs)
- [EventHorizon Architecture Overview](../README.md)
