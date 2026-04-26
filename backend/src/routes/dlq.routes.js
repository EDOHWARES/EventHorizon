const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const c = require('../controllers/dlq.controller');

/**
 * @swagger
 * tags:
 *   name: DLQ
 *   description: Dead Letter Queue management
 */

/**
 * @swagger
 * /api/dlq/jobs:
 *   get:
 *     summary: List failed jobs (DLQ)
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *         description: Filter by network (omit for all)
 *       - in: query
 *         name: start
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: end
 *         schema: { type: integer, default: 49 }
 *     responses:
 *       200:
 *         description: List of failed jobs with fail reasons and stack traces
 */
router.get('/jobs', asyncHandler(c.listFailed));

/**
 * @swagger
 * /api/dlq/stats:
 *   get:
 *     summary: DLQ statistics (failed counts per network)
 *     tags: [DLQ]
 *     responses:
 *       200:
 *         description: Per-network and total failed job counts
 */
router.get('/stats', asyncHandler(c.getStats));

/**
 * @swagger
 * /api/dlq/jobs/{jobId}/replay:
 *   post:
 *     summary: Replay (retry) a single failed job
 *     tags: [DLQ]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job re-queued
 *       404:
 *         description: Job not found
 */
router.post('/jobs/:jobId/replay', asyncHandler(c.replayJob));

/**
 * @swagger
 * /api/dlq/jobs/replay:
 *   post:
 *     summary: Bulk replay failed jobs
 *     tags: [DLQ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jobIds]
 *             properties:
 *               jobIds:
 *                 type: array
 *                 items: { type: string }
 *               network:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bulk replay results
 */
router.post('/jobs/replay', asyncHandler(c.bulkReplay));

/**
 * @swagger
 * /api/dlq/jobs:
 *   delete:
 *     summary: Bulk clear all failed jobs
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: network
 *         schema: { type: string }
 *         description: Limit clear to one network (omit for all)
 *     responses:
 *       200:
 *         description: Number of jobs removed
 */
router.delete('/jobs', asyncHandler(c.clearFailed));

module.exports = router;
