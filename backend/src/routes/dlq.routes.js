const express = require('express');
const router = express.Router();
const dlqController = require('../controllers/dlq.controller');

/**
 * @openapi
 * tags:
 *   - name: DLQ
 *     description: Dead Letter Queue management – inspect, re-drive, and purge failed action attempts.
 */

/**
 * @openapi
 * /api/dlq/stats:
 *   get:
 *     summary: Get DLQ statistics
 *     tags: [DLQ]
 *     responses:
 *       200:
 *         description: DLQ statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     pending:   { type: integer }
 *                     redriving: { type: integer }
 *                     resolved:  { type: integer }
 *                     purged:    { type: integer }
 *                     total:     { type: integer }
 */
router.get('/stats', dlqController.getStats);

/**
 * @openapi
 * /api/dlq/entries:
 *   get:
 *     summary: List DLQ entries
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, redriving, resolved, purged]
 *       - in: query
 *         name: triggerId
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Paginated list of DLQ entries
 */
router.get('/entries', dlqController.listEntries);

/**
 * @openapi
 * /api/dlq/entries/{id}/redrive:
 *   post:
 *     summary: Re-drive a single DLQ entry
 *     tags: [DLQ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Entry re-driven successfully
 *       404:
 *         description: Entry not found
 *       409:
 *         description: Entry is not in pending state
 */
router.post('/entries/:id/redrive', dlqController.redriveOne);

/**
 * @openapi
 * /api/dlq/redrive-all:
 *   post:
 *     summary: Re-drive all pending DLQ entries
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: triggerId
 *         schema:
 *           type: string
 *         description: Optional – limit to a specific trigger
 *     responses:
 *       200:
 *         description: Retry-all results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:     { type: integer }
 *                     succeeded: { type: integer }
 *                     failed:    { type: integer }
 *                     failures:  { type: array, items: { type: object } }
 */
router.post('/redrive-all', dlqController.redriveAll);

/**
 * @openapi
 * /api/dlq/purge:
 *   post:
 *     summary: Purge DLQ entries
 *     tags: [DLQ]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, resolved, purged]
 *                 default: pending
 *               triggerId:
 *                 type: string
 *               olderThanMs:
 *                 type: integer
 *                 description: Only purge entries older than this many milliseconds
 *     responses:
 *       200:
 *         description: Purge result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     purged: { type: integer }
 */
router.post('/purge', dlqController.purge);

module.exports = router;
