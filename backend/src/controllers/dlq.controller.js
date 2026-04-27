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
