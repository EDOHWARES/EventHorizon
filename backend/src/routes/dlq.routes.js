const express = require('express');
const router = express.Router();
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
