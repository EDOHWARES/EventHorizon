const dlq = require('../services/dlq.service');
const logger = require('../config/logger');

async function listFailed(req, res) {
    const { network, start = 0, end = 49 } = req.query;
    const jobs = await dlq.listFailed(network || null, Number(start), Number(end));
    res.json({ success: true, count: jobs.length, data: jobs });
}

async function replayJob(req, res) {
    const { jobId } = req.params;
    const { network } = req.query;
    const result = await dlq.replayJob(jobId, network || null);
    await dlq.checkThresholdAndAlert();
    res.json({ success: true, data: result });
}

async function bulkReplay(req, res) {
    const { jobIds, network } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ success: false, error: 'jobIds must be a non-empty array' });
    }
    const results = await Promise.allSettled(
        jobIds.map(id => dlq.replayJob(id, network || null))
    );
    const replayed = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results
        .map((r, i) => r.status === 'rejected' ? { jobId: jobIds[i], error: r.reason.message } : null)
        .filter(Boolean);

    await dlq.checkThresholdAndAlert();
    res.json({ success: true, data: { replayed, failed } });
}

async function clearFailed(req, res) {
    const { network } = req.query;
    const removed = await dlq.clearFailed(network || null);
    logger.info('DLQ bulk clear via API', { network, removed });
    res.json({ success: true, data: { removed } });
}

async function getStats(req, res) {
    const stats = await dlq.getStats();
    await dlq.checkThresholdAndAlert();
    res.json({ success: true, data: stats });
}

module.exports = { listFailed, replayJob, bulkReplay, clearFailed, getStats };
