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
const c = require('../controllers/dlq.controller');

/**
 * @swagger
 * tags:
 *   name: DLQ
 *   description: Dead Letter Queue management — inspect, replay, and clear failed jobs
 */

/**
 * @swagger
 * /api/dlq/stats:
 *   get:
 *     summary: Get failed job counts per network
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
 */
router.get('/stats', c.getStats);

/**
 * @swagger
 * /api/dlq/jobs:
 *   get:
 *     summary: List failed jobs with fail reasons and stack traces
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *         description: Filter by network (omit for all networks)
 *       - in: query
 *         name: start
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: end
 *         schema: { type: integer, default: 99 }
 *     responses:
 *       200:
 *         description: Failed jobs list
 *   delete:
 *     summary: Bulk-clear all failed jobs
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *         description: Scope to a specific network (omit for all)
 *     responses:
 *       200:
 *         description: Cleared job counts per network
 */
router.get('/jobs', c.getJobs);
router.delete('/jobs', c.clearAll);

/**
 * @swagger
 * /api/dlq/jobs/{jobId}:
 *   get:
 *     summary: Get a single failed job
 *     tags: [DLQ]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: network
 *         schema: { type: string, default: testnet }
 *     responses:
 *       200:
 *         description: Job details
 *       404:
 *         description: Job not found
 *   delete:
 *     summary: Remove a single failed job
 *     tags: [DLQ]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: network
 *         schema: { type: string, default: testnet }
 *     responses:
 *       200:
 *         description: Job removed
 *       404:
 *         description: Job not found
 */
router.get('/jobs/:jobId', c.getJob);
router.delete('/jobs/:jobId', c.clearJob);

/**
 * @swagger
 * /api/dlq/jobs/{jobId}/replay:
 *   post:
 *     summary: Replay a single failed job
 *     tags: [DLQ]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: network
 *         schema: { type: string, default: testnet }
 *     responses:
 *       200:
 *         description: Job replayed
 *       404:
 *         description: Job not found
 */
router.post('/jobs/:jobId/replay', c.replayJob);

/**
 * @swagger
 * /api/dlq/replay:
 *   post:
 *     summary: Replay all failed jobs
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *         description: Scope to a specific network (omit for all)
 *     responses:
 *       200:
 *         description: Replay summary per network
 */
router.post('/replay', c.replayAll);

module.exports = router;
