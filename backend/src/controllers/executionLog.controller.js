/**
 * executionLog.controller.js
 *
 * REST handlers for querying execution logs stored in TimescaleDB.
 * All routes are organisation-scoped — users only see their own data.
 */

const executionLogService = require('../services/executionLog.service');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const logger = require('../config/logger');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution-logs/triggers/:triggerId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/execution-logs/triggers/{triggerId}:
 *   get:
 *     summary: Get execution history for a trigger
 *     description: Returns paginated execution log entries for a specific trigger, stored in TimescaleDB.
 *     tags:
 *       - Execution Logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: triggerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [success, failure, retrying]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Paginated execution log entries.
 */
exports.getLogsForTrigger = asyncHandler(async (req, res) => {
    const { triggerId } = req.params;
    const {
        limit = 50,
        offset = 0,
        status,
        from,
        to,
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 500);
    const parsedOffset = parseInt(offset, 10) || 0;

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    if (fromDate && isNaN(fromDate.getTime())) {
        throw new AppError('Invalid "from" date', 400);
    }
    if (toDate && isNaN(toDate.getTime())) {
        throw new AppError('Invalid "to" date', 400);
    }

    const { rows, total } = await executionLogService.getLogsForTrigger(triggerId, {
        limit: parsedLimit,
        offset: parsedOffset,
        status,
        from: fromDate,
        to: toDate,
    });

    res.json({
        success: true,
        data: {
            logs: rows,
            pagination: {
                total,
                limit: parsedLimit,
                offset: parsedOffset,
                hasMore: parsedOffset + parsedLimit < total,
            },
        },
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution-logs/trends
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/execution-logs/trends:
 *   get:
 *     summary: Get execution trends for the organisation
 *     description: Returns time-bucketed execution counts and durations, optimised via TimescaleDB continuous aggregates.
 *     tags:
 *       - Execution Logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: triggerId
 *         schema:
 *           type: string
 *       - in: query
 *         name: network
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: interval
 *         description: Time bucket size
 *         schema:
 *           type: string
 *           enum: ["1 minute", "5 minutes", "15 minutes", "1 hour", "6 hours", "1 day"]
 *           default: "1 hour"
 *     responses:
 *       200:
 *         description: Bucketed execution trend data.
 */
exports.getTrends = asyncHandler(async (req, res) => {
    const organizationId = String(req.user.organization._id);
    const {
        triggerId,
        network,
        from,
        to,
        interval = '1 hour',
    } = req.query;

    const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000); // default: last 24 h
    const toDate = to ? new Date(to) : new Date();

    if (isNaN(fromDate.getTime())) throw new AppError('Invalid "from" date', 400);
    if (isNaN(toDate.getTime())) throw new AppError('Invalid "to" date', 400);

    const rows = await executionLogService.getExecutionTrends(organizationId, {
        triggerId,
        network,
        from: fromDate,
        to: toDate,
        bucketInterval: interval,
    });

    res.json({
        success: true,
        data: {
            interval,
            from: fromDate,
            to: toDate,
            buckets: rows,
        },
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution-logs/triggers/:triggerId/health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/execution-logs/triggers/{triggerId}/health:
 *   get:
 *     summary: Get health stats for a trigger
 *     description: Returns success rate and average duration over a configurable time window.
 *     tags:
 *       - Execution Logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: triggerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: windowHours
 *         schema:
 *           type: integer
 *           default: 24
 *     responses:
 *       200:
 *         description: Trigger health statistics.
 */
exports.getTriggerHealth = asyncHandler(async (req, res) => {
    const { triggerId } = req.params;
    const windowHours = Math.min(parseInt(req.query.windowHours, 10) || 24, 720); // cap at 30 days

    const stats = await executionLogService.getTriggerHealthStats(triggerId, windowHours);

    res.json({
        success: true,
        data: {
            triggerId,
            windowHours,
            ...stats,
        },
    });
});
