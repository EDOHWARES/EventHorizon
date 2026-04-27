const processor = require('./processor');
const queue = require('./queue');
const logger = require('../config/logger');

// Auto-scaling configuration
const MAX_WORKERS = parseInt(process.env.MAX_WORKER_REPLICAS || '5', 10);
const JOBS_PER_WORKER = parseInt(process.env.JOBS_PER_WORKER_THRESHOLD || '50', 10);
const SCALE_INTERVAL_MS = parseInt(process.env.SCALE_INTERVAL_MS || '10000', 10);

const activeWorkers = [];

/**
 * Evaluates queue backlog and scales workers up or down
 */
async function evaluateScaling() {
    try {
        const stats = await queue.getQueueStats();
        
        let totalWaiting = 0;
        for (const networkStats of Object.values(stats)) {
            totalWaiting += (networkStats.waiting || 0);
        }

        const desiredWorkers = Math.min(
            MAX_WORKERS,
            Math.max(1, Math.ceil(totalWaiting / JOBS_PER_WORKER))
        );

        if (desiredWorkers > activeWorkers.length) {
            const workersToAdd = desiredWorkers - activeWorkers.length;
            logger.info(`Scaling up workers: adding ${workersToAdd} workers`, {
                totalWaiting,
                currentWorkers: activeWorkers.length,
                desiredWorkers
            });
            for (let i = 0; i < workersToAdd; i++) {
                activeWorkers.push(processor.createWorker());
            }
        } else if (desiredWorkers < activeWorkers.length) {
            const workersToRemove = activeWorkers.length - desiredWorkers;
            logger.info(`Scaling down workers: removing ${workersToRemove} workers`, {
                totalWaiting,
                currentWorkers: activeWorkers.length,
                desiredWorkers
            });
            for (let i = 0; i < workersToRemove; i++) {
                const worker = activeWorkers.pop();
                if (worker) {
                    await worker.close();
                }
            }
        }
    } catch (error) {
        logger.error('Failed to evaluate scaling', { error: error.message });
    }
}

/**
 * Starts the worker auto-scaler
 */
function startScaler() {
    // Start at least one worker initially
    if (activeWorkers.length === 0) {
        activeWorkers.push(processor.createWorker());
    }
    
    const interval = setInterval(evaluateScaling, SCALE_INTERVAL_MS);
    
    return {
        interval,
        stop: async () => {
            clearInterval(interval);
            for (const worker of activeWorkers) {
                await worker.close();
            }
            activeWorkers.length = 0;
        }
    };
}

/**
 * Returns current metrics for HPA or monitoring
 */
async function getScalingMetrics() {
    try {
        const stats = await queue.getQueueStats();
        let totalWaiting = 0;
        let totalActive = 0;
        for (const networkStats of Object.values(stats)) {
            totalWaiting += (networkStats.waiting || 0);
            totalActive += (networkStats.active || 0);
        }
        return {
            totalWaiting,
            totalActive,
            currentWorkers: activeWorkers.length,
            maxWorkers: MAX_WORKERS,
            jobsPerWorkerThreshold: JOBS_PER_WORKER
        };
    } catch (error) {
        logger.error('Failed to get scaling metrics', { error: error.message });
        throw error;
    }
}

module.exports = {
    startScaler,
    evaluateScaling,
    getScalingMetrics,
    getActiveWorkersCount: () => activeWorkers.length,
    activeWorkers // Exported for testing purposes
};
