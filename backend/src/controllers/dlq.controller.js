const dlqService = require('../services/dlq.service');
const logger = require('../config/logger');

async function getStats(req, res) {
    try {
        const stats = await dlqService.getStats();
        res.json({ success: true, data: stats });
    } catch (err) {
        logger.error('DLQ getStats failed', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to retrieve DLQ statistics' });
    }
}

async function listEntries(req, res) {
    try {
        const { status, triggerId, page = 1, limit = 50 } = req.query;
        const result = await dlqService.listFailures({
            status,
            triggerId,
            page: Number(page),
            limit: Math.min(Number(limit), 200),
        });
        res.json({ success: true, data: result });
    } catch (err) {
        logger.error('DLQ listEntries failed', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to list DLQ entries' });
    }
}

async function redriveOne(req, res) {
    try {
        const entry = await dlqService.redriveOne(req.params.id);
        res.json({ success: true, data: entry });
    } catch (err) {
        const status = err.statusCode || 500;
        logger.error('DLQ redriveOne failed', { id: req.params.id, error: err.message });
        res.status(status).json({ success: false, error: err.message });
    }
}

async function redriveAll(req, res) {
    try {
        const { triggerId } = req.query;
        const result = await dlqService.redriveAll({ triggerId });
        res.json({ success: true, data: result });
    } catch (err) {
        logger.error('DLQ redriveAll failed', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to re-drive DLQ entries' });
    }
}

async function purge(req, res) {
    try {
        const { status = 'pending', triggerId, olderThanMs } = req.body || {};
        const result = await dlqService.purge({
            status,
            triggerId,
            olderThanMs: olderThanMs ? Number(olderThanMs) : undefined,
        });
        res.json({ success: true, data: result });
    } catch (err) {
        logger.error('DLQ purge failed', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to purge DLQ entries' });
    }
}

module.exports = { getStats, listEntries, redriveOne, redriveAll, purge };
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/dlq/stats
 * Failed job counts per network.
 */
const getStats = asyncHandler(async (req, res) => {
    const stats = await dlqService.getDLQStats();
    res.json({ success: true, data: stats });
});

/**
 * GET /api/dlq/jobs?network=testnet&start=0&end=99
 * List failed jobs with fail reasons and stack traces.
 */
const getJobs = asyncHandler(async (req, res) => {
    const { network, start = 0, end = 99 } = req.query;
    const data = await dlqService.getFailedJobs({ network, start: Number(start), end: Number(end) });
    res.json({ success: true, data });
});

/**
 * GET /api/dlq/jobs/:jobId?network=testnet
 * Get a single failed job.
 */
const getJob = asyncHandler(async (req, res) => {
    const { network = 'testnet' } = req.query;
    const job = await dlqService.getFailedJob(network, req.params.jobId);
    if (!job) throw new AppError('Job not found', 404);
    res.json({ success: true, data: job });
});

/**
 * POST /api/dlq/jobs/:jobId/replay?network=testnet
 * Replay a single failed job.
 */
const replayJob = asyncHandler(async (req, res) => {
    const { network = 'testnet' } = req.query;
    const result = await dlqService.replayJob(network, req.params.jobId);
    if (!result) throw new AppError('Job not found', 404);
    res.json({ success: true, data: result });
});

/**
 * POST /api/dlq/replay?network=testnet
 * Replay all failed jobs (optionally scoped to a network).
 */
const replayAll = asyncHandler(async (req, res) => {
    const { network } = req.query;
    const summary = await dlqService.replayAll(network);
    res.json({ success: true, data: summary });
});

/**
 * DELETE /api/dlq/jobs/:jobId?network=testnet
 * Remove a single failed job.
 */
const clearJob = asyncHandler(async (req, res) => {
    const { network = 'testnet' } = req.query;
    const result = await dlqService.clearJob(network, req.params.jobId);
    if (!result) throw new AppError('Job not found', 404);
    res.json({ success: true, data: result });
});

/**
 * DELETE /api/dlq/jobs?network=testnet
 * Bulk-clear all failed jobs (optionally scoped to a network).
 */
const clearAll = asyncHandler(async (req, res) => {
    const { network } = req.query;
    const summary = await dlqService.clearAll(network);
    res.json({ success: true, data: summary });
});

module.exports = { getStats, getJobs, getJob, replayJob, replayAll, clearJob, clearAll };
