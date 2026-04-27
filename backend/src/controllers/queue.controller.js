const { getQueueStats, cleanQueue, getActionQueue } = require('../worker/queue');
const batchService = require('../services/batch.service');
const logger = require('../config/logger');

/**
 * Get queue statistics
 */
async function getStats(req, res) {
    try {
        const stats = await getQueueStats();
        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        logger.error('Failed to get queue stats', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve queue statistics',
        });
    }
}

/**
 * Get recent jobs
 */
async function getJobs(req, res) {
    try {
        const { status = 'completed', limit = 50, network = 'testnet' } = req.query;
        const queue = getActionQueue(network);
        
        let jobs;
        switch (status) {
            case 'waiting':
                jobs = await queue.getWaiting(0, limit - 1);
                break;
            case 'active':
                jobs = await queue.getActive(0, limit - 1);
                break;
            case 'completed':
                jobs = await queue.getCompleted(0, limit - 1);
                break;
            case 'failed':
                jobs = await queue.getFailed(0, limit - 1);
                break;
            case 'delayed':
                jobs = await queue.getDelayed(0, limit - 1);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status. Use: waiting, active, completed, failed, or delayed',
                });
        }

        const jobData = jobs.map(job => ({
            id: job.id,
            name: job.name,
            data: job.data,
            progress: job.progress,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
        }));

        res.json({
            success: true,
            data: {
                status,
                count: jobData.length,
                jobs: jobData,
            },
        });
    } catch (error) {
        logger.error('Failed to get jobs', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve jobs',
        });
    }
}

/**
 * Clean old jobs from queue
 */
async function clean(req, res) {
    try {
        await cleanQueue();
        res.json({
            success: true,
            message: 'Queue cleaned successfully',
        });
    } catch (error) {
        logger.error('Failed to clean queue', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to clean queue',
        });
    }
}

/**
 * Get batch statistics
 */
async function getBatchStats(req, res) {
    try {
        const stats = batchService.getStats();
        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        logger.error('Failed to get batch stats', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve batch statistics',
        });
    }
}

/**
 * Flush all pending batches
 */
async function flushBatches(req, res) {
    try {
        batchService.flushAll();
        res.json({
            success: true,
            message: 'All pending batches flushed successfully',
        });
    } catch (error) {
        logger.error('Failed to flush batches', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to flush batches',
        });
    }
}

/**
 * Retry a failed job
 */
async function retryJob(req, res) {
    try {
        const { jobId } = req.params;
        const { network = 'testnet' } = req.query;
        
        const queue = getActionQueue(network);
        const job = await queue.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
            });
        }

        await job.retry();

        res.json({
            success: true,
            message: 'Job retry initiated',
            data: { jobId },
        });
    } catch (error) {
        logger.error('Failed to retry job', { 
            jobId: req.params.jobId,
            error: error.message 
        });
        res.status(500).json({
            success: false,
            error: 'Failed to retry job',
        });
    }
}

module.exports = {
    getStats,
    getJobs,
    clean,
    retryJob,
};
