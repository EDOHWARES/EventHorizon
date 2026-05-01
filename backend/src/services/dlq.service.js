const FailedAction = require('../models/failedAction.model');
const logger = require('../config/logger');

/**
 * Record a failed action attempt into the DLQ collection.
 */
async function recordFailure({ triggerId, triggerSnapshot, eventPayload, errorMessage, attemptsMade = 1, jobId }) {
    const entry = await FailedAction.create({
        triggerId,
        triggerSnapshot,
        eventPayload,
        errorMessage,
        attemptsMade,
        jobId,
        status: 'pending',
    });
    logger.warn('Action recorded in DLQ', { dlqId: entry._id, triggerId, errorMessage });
    return entry;
}

/**
 * List DLQ entries with optional status filter and pagination.
 */
async function listFailures({ status, triggerId, page = 1, limit = 50 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (triggerId) filter.triggerId = triggerId;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
        FailedAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        FailedAction.countDocuments(filter),
    ]);

    return { items, total, page, limit };
}

/**
 * Re-drive a single DLQ entry by re-enqueuing its action.
 */
async function redriveOne(dlqId) {
    const entry = await FailedAction.findById(dlqId);
    if (!entry) throw Object.assign(new Error('DLQ entry not found'), { statusCode: 404 });
    if (entry.status !== 'pending') {
        throw Object.assign(new Error(`Entry is not in pending state (current: ${entry.status})`), { statusCode: 409 });
    }

    entry.status = 'redriving';
    await entry.save();

    try {
        const { enqueueAction } = require('../worker/queue');
        await enqueueAction(entry.triggerSnapshot, entry.eventPayload);
        entry.status = 'resolved';
        entry.resolvedAt = new Date();
        await entry.save();
        logger.info('DLQ entry re-driven successfully', { dlqId });
        return entry;
    } catch (err) {
        entry.status = 'pending';
        await entry.save();
        throw err;
    }
}

/**
 * Re-drive all pending DLQ entries (optionally filtered by triggerId).
 */
async function redriveAll({ triggerId } = {}) {
    const filter = { status: 'pending' };
    if (triggerId) filter.triggerId = triggerId;

    const entries = await FailedAction.find(filter).lean();
    const results = { total: entries.length, succeeded: 0, failed: 0, failures: [] };

    const { enqueueAction } = require('../worker/queue');

    for (const entry of entries) {
        try {
            await FailedAction.findByIdAndUpdate(entry._id, { status: 'redriving' });
            await enqueueAction(entry.triggerSnapshot, entry.eventPayload);
            await FailedAction.findByIdAndUpdate(entry._id, { status: 'resolved', resolvedAt: new Date() });
            results.succeeded++;
        } catch (err) {
            await FailedAction.findByIdAndUpdate(entry._id, { status: 'pending' });
            results.failed++;
            results.failures.push({ id: entry._id, error: err.message });
            logger.error('Failed to re-drive DLQ entry', { dlqId: entry._id, error: err.message });
        }
    }

    logger.info('DLQ retry-all completed', results);
    return results;
}

/**
 * Purge (mark as purged) DLQ entries. Optionally filter by status or triggerId.
 */
async function purge({ status = 'pending', triggerId, olderThanMs } = {}) {
    const filter = { status };
    if (triggerId) filter.triggerId = triggerId;
    if (olderThanMs) filter.createdAt = { $lt: new Date(Date.now() - olderThanMs) };

    const result = await FailedAction.updateMany(filter, { status: 'purged' });
    logger.info('DLQ purge completed', { matched: result.matchedCount });
    return { purged: result.matchedCount };
}

/**
 * Get DLQ statistics.
 */
async function getStats() {
    const counts = await FailedAction.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const stats = { pending: 0, redriving: 0, resolved: 0, purged: 0 };
    for (const { _id, count } of counts) stats[_id] = count;
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
    return stats;
}

module.exports = { recordFailure, listFailures, redriveOne, redriveAll, purge, getStats };
const { queues } = require('../worker/queue');
const slackService = require('./slack.service');
const axios = require('axios');
const logger = require('../config/logger');

const DLQ_THRESHOLD = Number(process.env.DLQ_ALERT_THRESHOLD || 10);

/**
 * Format a failed BullMQ job for API responses.
 */
function formatJob(job) {
    return {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
    };
}

/**
 * Get all failed jobs across all networks (or a specific one).
 */
async function getFailedJobs({ network, start = 0, end = 99 } = {}) {
    const result = {};
    const targets = network ? { [network]: queues[network] } : queues;

    for (const [net, queue] of Object.entries(targets)) {
        if (!queue) continue;
        const jobs = await queue.getFailed(start, end);
        result[net] = jobs.map(formatJob);
    }
    return result;
}

/**
 * Get a single failed job by id.
 */
async function getFailedJob(network, jobId) {
    const queue = queues[network];
    if (!queue) throw new Error(`Queue for network '${network}' not found`);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    return formatJob(job);
}

/**
 * Replay (retry) a single failed job.
 */
async function replayJob(network, jobId) {
    const queue = queues[network];
    if (!queue) throw new Error(`Queue for network '${network}' not found`);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    await job.retry('failed');
    logger.info('DLQ: job replayed', { network, jobId });
    return { jobId, status: 'replayed' };
}

/**
 * Replay all failed jobs for a network (or all networks).
 */
async function replayAll(network) {
    const targets = network ? { [network]: queues[network] } : queues;
    const summary = {};

    for (const [net, queue] of Object.entries(targets)) {
        if (!queue) continue;
        const jobs = await queue.getFailed(0, -1);
        let replayed = 0;
        for (const job of jobs) {
            try {
                await job.retry('failed');
                replayed++;
            } catch (err) {
                logger.warn('DLQ: failed to replay job', { net, jobId: job.id, error: err.message });
            }
        }
        summary[net] = { replayed, total: jobs.length };
        logger.info('DLQ: bulk replay', { network: net, ...summary[net] });
    }
    return summary;
}

/**
 * Remove a single failed job.
 */
async function clearJob(network, jobId) {
    const queue = queues[network];
    if (!queue) throw new Error(`Queue for network '${network}' not found`);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    await job.remove();
    logger.info('DLQ: job removed', { network, jobId });
    return { jobId, status: 'removed' };
}

/**
 * Bulk-clear all failed jobs for a network (or all networks).
 */
async function clearAll(network) {
    const targets = network ? { [network]: queues[network] } : queues;
    const summary = {};

    for (const [net, queue] of Object.entries(targets)) {
        if (!queue) continue;
        // BullMQ clean: grace=0, limit=0 (unlimited), type='failed'
        const removed = await queue.clean(0, 0, 'failed');
        summary[net] = { removed: removed.length };
        logger.info('DLQ: bulk clear', { network: net, removed: removed.length });
    }
    return summary;
}

/**
 * Get DLQ counts per network.
 */
async function getDLQStats() {
    const stats = {};
    for (const [net, queue] of Object.entries(queues)) {
        const counts = await queue.getJobCounts('failed');
        stats[net] = counts.failed ?? 0;
    }
    return stats;
}

// ─── Alerting ────────────────────────────────────────────────────────────────

async function sendDiscordAlert(webhookUrl, message) {
    await axios.post(webhookUrl, { content: message });
}

/**
 * Check DLQ thresholds and fire alerts if exceeded.
 * Called after job failures or on a schedule.
 */
async function checkAndAlert() {
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    const discordUrl = process.env.DLQ_DISCORD_WEBHOOK_URL;

    if (!slackUrl && !discordUrl) return;

    const stats = await getDLQStats();
    const breached = Object.entries(stats).filter(([, count]) => count >= DLQ_THRESHOLD);

    if (breached.length === 0) return;

    const lines = breached.map(([net, count]) => `• ${net}: ${count} failed jobs`).join('\n');
    const text = `🚨 *DLQ Alert* — Failed job threshold (${DLQ_THRESHOLD}) exceeded:\n${lines}`;

    const tasks = [];

    if (slackUrl) {
        tasks.push(
            slackService.sendSlackAlert(slackUrl, { text }).catch(err =>
                logger.error('DLQ Slack alert failed', { error: err.message })
            )
        );
    }

    if (discordUrl) {
        tasks.push(
            sendDiscordAlert(discordUrl, text).catch(err =>
                logger.error('DLQ Discord alert failed', { error: err.message })
            )
        );
    }

    await Promise.all(tasks);
    logger.info('DLQ alert sent', { breached: breached.map(([n]) => n) });
}

module.exports = {
    getFailedJobs,
    getFailedJob,
    replayJob,
    replayAll,
    clearJob,
    clearAll,
    getDLQStats,
    checkAndAlert,
};
