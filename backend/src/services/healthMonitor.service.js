const mongoose = require('mongoose');
const logger = require('../config/logger');
const pagerdutyService = require('./pagerduty.service');

class HealthMonitorService {
    constructor() {
        this.intervalId = null;
        this.status = {
            database: true,
            worker: true
        };
        this.DEDUP_KEYS = {
            database: 'eventhorizon-database-down',
            worker: 'eventhorizon-worker-down'
        };
        // Polling interval in milliseconds (default 60s)
        this.intervalMs = process.env.HEALTH_CHECK_INTERVAL_MS || 60000;
    }

    start() {
        if (this.intervalId) {
            return;
        }

        logger.info('HealthMonitor service started', { intervalMs: this.intervalMs });
        this.intervalId = setInterval(() => this.checkHealth(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger.info('HealthMonitor service stopped');
        }
    }

    async checkHealth() {
        await this.checkDatabaseHealth();
        await this.checkWorkerHealth();
    }

    async checkDatabaseHealth() {
        // readyState 1 means connected
        const isDbHealthy = mongoose.connection.readyState === 1;

        if (!isDbHealthy && this.status.database) {
            this.status.database = false;
            logger.error('HealthMonitor: Database connection lost');
            await pagerdutyService.triggerIncident(
                '[Critical] EventHorizon Database Down',
                'EventHorizon HealthMonitor',
                { readyState: mongoose.connection.readyState },
                this.DEDUP_KEYS.database
            ).catch(err => logger.error('HealthMonitor: Failed to trigger PagerDuty for Database', { error: err.message }));
        } else if (isDbHealthy && !this.status.database) {
            this.status.database = true;
            logger.info('HealthMonitor: Database connection recovered');
            await pagerdutyService.resolveIncident(this.DEDUP_KEYS.database)
                .catch(err => logger.error('HealthMonitor: Failed to resolve PagerDuty for Database', { error: err.message }));
        }
    }

    async checkWorkerHealth() {
        let isWorkerHealthy = true;
        let workerState = null;

        try {
            const pollerState = require('../worker/pollerState');
            workerState = pollerState.getState();
            // Assuming pollerState has an isRunning flag or similar we can check. 
            // If the process is alive, we just check if it's currently flagged as running or healthy.
            // Even just getting the state without throwing is a basic health check.
            if (workerState && workerState.isPolling === false && workerState.lastError) {
               isWorkerHealthy = false;
            }
        } catch (error) {
            isWorkerHealthy = false;
            workerState = { error: error.message };
        }

        if (!isWorkerHealthy && this.status.worker) {
            this.status.worker = false;
            logger.error('HealthMonitor: Worker failure detected');
            await pagerdutyService.triggerIncident(
                '[Critical] EventHorizon Worker Failed',
                'EventHorizon HealthMonitor',
                { state: workerState },
                this.DEDUP_KEYS.worker
            ).catch(err => logger.error('HealthMonitor: Failed to trigger PagerDuty for Worker', { error: err.message }));
        } else if (isWorkerHealthy && !this.status.worker) {
            this.status.worker = true;
            logger.info('HealthMonitor: Worker recovered');
            await pagerdutyService.resolveIncident(this.DEDUP_KEYS.worker)
                .catch(err => logger.error('HealthMonitor: Failed to resolve PagerDuty for Worker', { error: err.message }));
        }
    }
}

module.exports = new HealthMonitorService();
