const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
    getLogsForTrigger,
    getTrends,
    getTriggerHealth,
} = require('../controllers/executionLog.controller');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/execution-logs/trends
 * Organisation-wide execution trends (time-bucketed).
 */
router.get('/trends', getTrends);

/**
 * GET /api/execution-logs/triggers/:triggerId
 * Paginated execution history for a specific trigger.
 */
router.get('/triggers/:triggerId', getLogsForTrigger);

/**
 * GET /api/execution-logs/triggers/:triggerId/health
 * Health stats (success rate, avg duration) for a trigger.
 */
router.get('/triggers/:triggerId/health', getTriggerHealth);

module.exports = router;
