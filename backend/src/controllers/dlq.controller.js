const dlqService = require('../services/dlq.service');
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
