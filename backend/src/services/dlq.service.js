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
