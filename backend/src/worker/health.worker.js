const healthService = require('../services/health.service');
const logger = require('../config/logger');

/**
 * Health worker for periodic health checks
 */
class HealthWorker {
    constructor() {
        this.interval = null;
        this.isRunning = false;
        // Default to every 5 minutes for the worker to check for due triggers
        this.workerIntervalMs = process.env.HEALTH_WORKER_INTERVAL_MS || 300000;
    }

    /**
     * Start the health worker
     */
    start() {
        if (this.interval) {
            logger.warn('Health worker is already running');
            return;
        }

        logger.info('Starting Health Worker', {
            intervalMs: this.workerIntervalMs
        });

        this.interval = setInterval(async () => {
            if (this.isRunning) {
                logger.debug('Health check cycle still in progress, skipping');
                return;
            }

            this.isRunning = true;
            try {
                await healthService.runAllHealthChecks();
            } catch (error) {
                logger.error('Error in health worker cycle', {
                    error: error.message,
                    stack: error.stack
                });
            } finally {
                this.isRunning = false;
            }
        }, this.workerIntervalMs);

        // Run immediately on start
        this.runImmediate();
    }

    /**
     * Stop the health worker
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('Health Worker stopped');
        }
    }

    /**
     * Run a health check cycle immediately
     */
    async runImmediate() {
        logger.info('Running immediate health check cycle');
        this.isRunning = true;
        try {
            await healthService.runAllHealthChecks();
        } catch (error) {
            logger.error('Error in immediate health check cycle', {
                error: error.message
            });
        } finally {
            this.isRunning = false;
        }
    }
}

module.exports = new HealthWorker();
