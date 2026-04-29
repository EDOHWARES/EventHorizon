const systemHealthMonitorService = require('../services/systemHealthMonitor.service');

/**
 * Middleware to record API request metrics for system health monitoring
 */
function recordAPIMetric(req, res, next) {
    const startTime = Date.now();

    // Intercept res.json and res.send to capture response
    const originalJson = res.json;
    const originalSend = res.send;

    res.json = function(data) {
        const responseTime = Date.now() - startTime;
        const isError = res.statusCode >= 400;
        systemHealthMonitorService.recordAPIMetric(responseTime, isError);
        return originalJson.call(this, data);
    };

    res.send = function(data) {
        const responseTime = Date.now() - startTime;
        const isError = res.statusCode >= 400;
        systemHealthMonitorService.recordAPIMetric(responseTime, isError);
        return originalSend.call(this, data);
    };

    next();
}

module.exports = recordAPIMetric;
