# Backend Worker Scaling

The EventHorizon backend implements a robust worker auto-scaling mechanism based on Redis queue metrics.

## Architecture

The scaling is performed internally within the Node.js process to minimize "cold-start time" of new worker instances. When the system detects a spike in the BullMQ queue backlog, it dynamically spawns additional `Worker` instances for the existing process. When the backlog is cleared, the system closes those extra workers.

### Configuration Variables

You can configure the behavior of the internal scaler using the following environment variables:

- `MAX_WORKER_REPLICAS`: Maximum number of worker instances to scale up to. (Default: 5)
- `JOBS_PER_WORKER_THRESHOLD`: How many waiting jobs justify creating an additional worker. (Default: 50)
- `SCALE_INTERVAL_MS`: How often to evaluate the queue backlog. (Default: 10000 ms)

## Kubernetes HPA Integration

If you prefer to scale Kubernetes Pods rather than relying entirely on internal node process scaling, you can integrate this with a **Kubernetes Horizontal Pod Autoscaler (HPA)** using custom metrics.

### Exposing Metrics

The API exposes an endpoint to retrieve the current scaling metrics:

`GET /api/queue/metrics`

**Response Example:**
```json
{
    "success": true,
    "data": {
        "totalWaiting": 120,
        "totalActive": 3,
        "currentWorkers": 3,
        "maxWorkers": 5,
        "jobsPerWorkerThreshold": 50
    }
}
```

### Kubernetes Metrics Adapter

To configure K8s HPA to use this data, you must deploy a metrics adapter (such as the **Prometheus Adapter**) that scrapes these values (if you export them to Prometheus format), or use an external metrics server that can parse JSON from this REST endpoint.

HPA Configuration Example:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: eventhorizon-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: eventhorizon-worker
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: External
    external:
      metric:
        name: queue_total_waiting
      target:
        type: AverageValue
        averageValue: 50
```

*Note: In the HPA scenario, we recommend decreasing the internal `MAX_WORKER_REPLICAS` to 1 or 2 to let Kubernetes handle the scaling at the Pod level instead of thread level.*
