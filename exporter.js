const http = require('http');
const client = require('prom-client');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add a default label to all metrics
register.setDefaultLabels({
  app: 'eventhorizon-backend'
});

// Enable the collection of default metrics (CPU/Memory usage, etc.)
client.collectDefaultMetrics({ register });

// Track success/failure rates of actions
const actionStatusCounter = new client.Counter({
  name: 'eventhorizon_action_status_total',
  help: 'Total number of actions executed, labeled by status (success/failure) and action_type',
  labelNames: ['status', 'action_type'],
});
register.registerMetric(actionStatusCounter);

// Monitor queue latency
const queueLatencyHistogram = new client.Histogram({
  name: 'eventhorizon_queue_latency_seconds',
  help: 'Latency of actions in the queue in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10] // Buckets for latency observation
});
register.registerMetric(queueLatencyHistogram);

/**
 * Record a successful action
 * @param {string} actionType - The type of action performed
 */
function recordActionSuccess(actionType) {
    actionStatusCounter.labels('success', actionType).inc();
}

/**
 * Record a failed action
 * @param {string} actionType - The type of action performed
 */
function recordActionFailure(actionType) {
    actionStatusCounter.labels('failure', actionType).inc();
}

/**
 * Record the time an action spent in the queue
 * @param {number} latencyInSeconds - The queue latency
 */
function recordQueueLatency(latencyInSeconds) {
    queueLatencyHistogram.observe(latencyInSeconds);
}

/**
 * Start the HTTP server to expose the /metrics endpoint
 * @param {number} port - Port to listen on (default 9090)
 */
function startMetricsServer(port = 9090) {
    const server = http.createServer(async (req, res) => {
        if (req.url === '/metrics' && req.method === 'GET') {
            res.setHeader('Content-Type', register.contentType);
            try {
                const metrics = await register.metrics();
                res.end(metrics);
            } catch (err) {
                res.statusCode = 500;
                res.end(err.message);
            }
        } else {
            res.statusCode = 404;
            res.end('Not Found');
        }
    });

    server.listen(port, () => {
        console.log(`Prometheus Exporter listening on http://0.0.0.0:${port}/metrics`);
    });

    return server;
}

module.exports = {
    startMetricsServer,
    recordActionSuccess,
    recordActionFailure,
    recordQueueLatency,
    register // Exported for testing purposes
};