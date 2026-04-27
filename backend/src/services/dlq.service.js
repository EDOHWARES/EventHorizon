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
