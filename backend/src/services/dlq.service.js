const axios = require('axios');
const { queues } = require('../worker/queue');
const logger = require('../config/logger');

const DLQ_THRESHOLD = parseInt(process.env.DLQ_THRESHOLD || '10', 10);

/** Serialize a BullMQ job into a DLQ-friendly shape. */
function serializeJob(job, network) {
    return {
        id: job.id,
        name: job.name,
        network,
        data: job.data,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
    };
}

/**
 * List failed jobs across all (or a specific) network queue.
 * @param {string|null} network  - filter to one network, or null for all
 * @param {number} start
 * @param {number} end
 */
async function listFailed(network = null, start = 0, end = 49) {
    const targets = network
        ? { [network]: queues[network] }
        : queues;

    if (network && !queues[network]) {
        throw new Error(`Queue for network "${network}" not found`);
    }

    const results = [];
    for (const [net, queue] of Object.entries(targets)) {
        const jobs = await queue.getFailed(start, end);
        results.push(...jobs.map(j => serializeJob(j, net)));
    }
    return results;
}

/**
 * Replay (retry) a single failed job by id.
 * Searches all queues unless network is specified.
 */
async function replayJob(jobId, network = null) {
    const targets = network ? { [network]: queues[network] } : queues;

    for (const [net, queue] of Object.entries(targets)) {
        const job = await queue.getJob(jobId);
        if (job) {
            await job.retry('failed');
            logger.info('DLQ: job replayed', { jobId, network: net });
            return { jobId, network: net };
        }
    }
    throw Object.assign(new Error('Job not found'), { statusCode: 404 });
}

/**
 * Bulk-clear all failed jobs across all (or a specific) network queue.
 * Returns the total count removed.
 */
async function clearFailed(network = null) {
    const targets = network ? { [network]: queues[network] } : queues;
    let total = 0;

    for (const queue of Object.values(targets)) {
        // grace=0 removes jobs immediately; limit=Infinity clears all
        const removed = await queue.clean(0, Infinity, 'failed');
        total += removed.length;
    }
    logger.info('DLQ: bulk clear completed', { network, removed: total });
    return total;
}

/**
 * Return per-network failed counts and a grand total.
 */
async function getStats() {
    const perNetwork = {};
    let total = 0;

    for (const [net, queue] of Object.entries(queues)) {
        const counts = await queue.getJobCounts('failed');
        perNetwork[net] = counts.failed ?? 0;
        total += perNetwork[net];
    }
    return { total, perNetwork };
}

/**
 * Send a DLQ threshold alert to Slack and/or Discord.
 * Called automatically after any operation that may change the failed count.
 */
async function checkThresholdAndAlert() {
    const { total } = await getStats();
    if (total < DLQ_THRESHOLD) return;

    const text = `🚨 *DLQ Alert*: ${total} failed jobs across all queues (threshold: ${DLQ_THRESHOLD})`;

    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    const discordUrl = process.env.DISCORD_WEBHOOK_URL;

    const sends = [];

    if (slackUrl) {
        sends.push(
            axios.post(slackUrl, { text }).catch(err =>
                logger.error('DLQ Slack alert failed', { error: err.message })
            )
        );
    }

    if (discordUrl) {
        sends.push(
            axios.post(discordUrl, { content: text }).catch(err =>
                logger.error('DLQ Discord alert failed', { error: err.message })
            )
        );
    }

    await Promise.all(sends);
}

module.exports = { listFailed, replayJob, clearFailed, getStats, checkThresholdAndAlert };
