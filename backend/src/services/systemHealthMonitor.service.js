const SystemHealth = require('../models/systemHealth.model');
const { getQueueStats, queues } = require('../worker/queue');
const mongoose = require('mongoose');
const logger = require('../config/logger');

/**
 * Service to monitor and track system health metrics
 */
class SystemHealthMonitorService {
    constructor() {
        this.metricsBuffer = {
            requestCount: 0,
            errorCount: 0,
            responseTimes: [],
            webhookAttempts: 0,
            webhookSuccesses: 0,
            webhookFailures: 0,
            webhookRateLimits: 0,
            webhookResponseTimes: [],
        };
        this.startTime = Date.now();
    }

    /**
     * Collects comprehensive system health metrics
     * @param {String} organizationId - Organization ID
     * @returns {Promise<Object>} Health metrics
     */
    async collectHealthMetrics(organizationId) {
        const metrics = {
            timestamp: new Date(),
            organization: organizationId,
            queue: await this.getQueueHealth(),
            database: await this.getDatabaseHealth(),
            api: this.getAPIHealth(),
            webhooks: this.getWebhookHealth(),
            externalServices: await this.getExternalServicesHealth(),
            alerts: [],
        };

        // Calculate overall status and health score
        const { overallStatus, healthScore } = this.calculateHealthScore(metrics);
        metrics.overallStatus = overallStatus;
        metrics.healthScore = healthScore;

        return metrics;
    }

    /**
     * Gets queue health metrics from all networks
     * @returns {Promise<Object>} Queue health
     */
    async getQueueHealth() {
        try {
            const stats = await getQueueStats();
            
            // Aggregate stats across all networks
            const aggregated = {
                activeName: 'aggregated',
                activeCount: 0,
                waitingCount: 0,
                completedCount: 0,
                failedCount: 0,
                delayedCount: 0,
                isPaused: false,
            };

            for (const [network, networkStats] of Object.entries(stats)) {
                aggregated.activeCount += networkStats.active || 0;
                aggregated.waitingCount += networkStats.waiting || 0;
                aggregated.completedCount += networkStats.completed || 0;
                aggregated.failedCount += networkStats.failed || 0;
                aggregated.delayedCount += networkStats.delayed || 0;
            }

            return aggregated;
        } catch (error) {
            logger.error('Failed to get queue health:', error.message);
            return {
                activeName: 'error',
                activeCount: 0,
                waitingCount: 0,
                completedCount: 0,
                failedCount: 0,
                delayedCount: 0,
                error: error.message,
            };
        }
    }

    /**
     * Gets database health metrics
     * @returns {Promise<Object>} Database health
     */
    async getDatabaseHealth() {
        try {
            const startTime = Date.now();
            
            // Perform a simple health check query
            const result = await mongoose.connection.db.admin().ping();
            const responseTime = Date.now() - startTime;

            return {
                connected: result.ok === 1,
                responseTimeMs: responseTime,
                error: null,
            };
        } catch (error) {
            return {
                connected: false,
                responseTimeMs: 0,
                error: error.message,
            };
        }
    }

    /**
     * Gets API health metrics from the buffer
     * @returns {Object} API health
     */
    getAPIHealth() {
        const uptime = Date.now() - this.startTime;
        const avgResponseTime = this.metricsBuffer.responseTimes.length > 0
            ? this.metricsBuffer.responseTimes.reduce((a, b) => a + b, 0) / this.metricsBuffer.responseTimes.length
            : 0;

        // Calculate p95 response time
        const sortedTimes = [...this.metricsBuffer.responseTimes].sort((a, b) => a - b);
        const p95Index = Math.ceil(sortedTimes.length * 0.95) - 1;
        const p95ResponseTime = p95Index >= 0 ? sortedTimes[p95Index] : 0;

        return {
            uptime,
            requestCount: this.metricsBuffer.requestCount,
            errorCount: this.metricsBuffer.errorCount,
            avgResponseTimeMs: Math.round(avgResponseTime),
            p95ResponseTimeMs: Math.round(p95ResponseTime),
        };
    }

    /**
     * Gets webhook health metrics from the buffer
     * @returns {Object} Webhook health
     */
    getWebhookHealth() {
        const avgResponseTime = this.metricsBuffer.webhookResponseTimes.length > 0
            ? this.metricsBuffer.webhookResponseTimes.reduce((a, b) => a + b, 0) / this.metricsBuffer.webhookResponseTimes.length
            : 0;

        return {
            totalAttempts: this.metricsBuffer.webhookAttempts,
            successCount: this.metricsBuffer.webhookSuccesses,
            failureCount: this.metricsBuffer.webhookFailures,
            rateLimitedCount: this.metricsBuffer.webhookRateLimits,
            avgResponseTimeMs: Math.round(avgResponseTime),
        };
    }

    /**
     * Gets external services health
     * @returns {Promise<Array>} External services health
     */
    async getExternalServicesHealth() {
        const services = ['slack', 'discord', 'telegram', 'soroban-rpc'];
        const health = [];

        // Add current service health checks (can be extended with actual API checks)
        for (const service of services) {
            health.push({
                name: service,
                status: 'healthy', // This can be updated with actual checks
                lastCheckAt: new Date(),
                responseTimeMs: 0,
                error: null,
            });
        }

        return health;
    }

    /**
     * Calculates overall health status and score
     * @param {Object} metrics - Collected metrics
     * @returns {Object} { overallStatus, healthScore }
     */
    calculateHealthScore(metrics) {
        let healthScore = 100;
        let hasIssues = false;

        const { queue, database, api, webhooks } = metrics;

        // Queue health (30% of score)
        if (queue.failedCount > 50) {
            healthScore -= 30;
            hasIssues = true;
        } else if (queue.failedCount > 20) {
            healthScore -= 15;
        } else if (queue.failedCount > 5) {
            healthScore -= 5;
        }

        // Database health (25% of score)
        if (!database.connected) {
            healthScore -= 25;
            hasIssues = true;
        } else if (database.responseTimeMs > 1000) {
            healthScore -= 15;
            hasIssues = true;
        } else if (database.responseTimeMs > 500) {
            healthScore -= 5;
        }

        // API health (25% of score)
        if (api.errorCount > 100) {
            healthScore -= 20;
            hasIssues = true;
        } else if (api.errorCount > 50) {
            healthScore -= 10;
        } else if (api.errorCount > 10) {
            healthScore -= 5;
        }

        if (api.avgResponseTimeMs > 2000) {
            healthScore -= 15;
            hasIssues = true;
        } else if (api.avgResponseTimeMs > 1000) {
            healthScore -= 5;
        }

        // Webhook health (15% of score)
        if (webhooks.failureCount > 0) {
            const failureRate = webhooks.failureCount / Math.max(webhooks.totalAttempts, 1);
            if (failureRate > 0.5) {
                healthScore -= 15;
                hasIssues = true;
            } else if (failureRate > 0.2) {
                healthScore -= 8;
            } else {
                healthScore -= 3;
            }
        }

        // Ensure score stays within bounds
        healthScore = Math.max(0, Math.min(100, healthScore));

        // Determine overall status
        let overallStatus = 'healthy';
        if (healthScore < 50) {
            overallStatus = 'unhealthy';
        } else if (healthScore < 75 || hasIssues) {
            overallStatus = 'degraded';
        }

        return { overallStatus, healthScore };
    }

    /**
     * Records an API metric
     * @param {Number} responseTimeMs - Response time in milliseconds
     * @param {Boolean} isError - Whether the request failed
     */
    recordAPIMetric(responseTimeMs, isError = false) {
        this.metricsBuffer.requestCount++;
        if (isError) {
            this.metricsBuffer.errorCount++;
        }
        
        // Keep only last 1000 response times to avoid memory issues
        this.metricsBuffer.responseTimes.push(responseTimeMs);
        if (this.metricsBuffer.responseTimes.length > 1000) {
            this.metricsBuffer.responseTimes.shift();
        }
    }

    /**
     * Records a webhook metric
     * @param {Number} responseTimeMs - Response time
     * @param {String} result - 'success', 'failure', 'rate_limited'
     */
    recordWebhookMetric(responseTimeMs, result = 'success') {
        this.metricsBuffer.webhookAttempts++;
        this.metricsBuffer.webhookResponseTimes.push(responseTimeMs);
        
        if (this.metricsBuffer.webhookResponseTimes.length > 1000) {
            this.metricsBuffer.webhookResponseTimes.shift();
        }

        switch (result) {
            case 'success':
                this.metricsBuffer.webhookSuccesses++;
                break;
            case 'failure':
                this.metricsBuffer.webhookFailures++;
                break;
            case 'rate_limited':
                this.metricsBuffer.webhookRateLimits++;
                this.metricsBuffer.webhookFailures++;
                break;
        }
    }

    /**
     * Saves health metrics to database
     * @param {Object} metrics - Health metrics
     * @returns {Promise<Object>} Saved document
     */
    async saveHealthMetrics(metrics) {
        try {
            const healthDoc = new SystemHealth(metrics);
            return await healthDoc.save();
        } catch (error) {
            logger.error('Failed to save health metrics:', error.message);
            throw error;
        }
    }

    /**
     * Gets latest health status for organization
     * @param {String} organizationId - Organization ID
     * @returns {Promise<Object>} Latest health metrics
     */
    async getLatestHealth(organizationId) {
        try {
            const health = await SystemHealth.findOne(
                { organization: organizationId },
                null,
                { sort: { timestamp: -1 } }
            );
            return health || null;
        } catch (error) {
            logger.error('Failed to get latest health:', error.message);
            return null;
        }
    }

    /**
     * Gets health history for organization
     * @param {String} organizationId - Organization ID
     * @param {Number} hours - Number of hours to look back
     * @returns {Promise<Array>} Health history
     */
    async getHealthHistory(organizationId, hours = 24) {
        try {
            const since = new Date(Date.now() - hours * 60 * 60 * 1000);
            const history = await SystemHealth.find(
                {
                    organization: organizationId,
                    timestamp: { $gte: since }
                },
                null,
                { sort: { timestamp: -1 } }
            );
            return history;
        } catch (error) {
            logger.error('Failed to get health history:', error.message);
            return [];
        }
    }

    /**
     * Resets metrics buffer (typically done periodically)
     */
    resetMetricsBuffer() {
        this.metricsBuffer = {
            requestCount: 0,
            errorCount: 0,
            responseTimes: [],
            webhookAttempts: 0,
            webhookSuccesses: 0,
            webhookFailures: 0,
            webhookRateLimits: 0,
            webhookResponseTimes: [],
        };
    }
}

module.exports = new SystemHealthMonitorService();
