'use strict';

const express = require('express');
const router = express.Router();
const escrowVersions = require('../config/escrowVersions');
const logger = require('../config/logger');

/**
 * Admin token middleware – mirrors the pattern used by audit.routes.js.
 * Reads ADMIN_ACCESS_TOKEN from the environment; rejects with 401 if
 * the header is absent and 403 if it does not match.
 */
function adminAuth(req, res, next) {
  const token = process.env.ADMIN_ACCESS_TOKEN;
  if (!token) {
    return res.status(503).json({
      success: false,
      error: 'Admin access is not configured on this server.',
    });
  }

  const provided = req.headers['x-admin-token'];
  if (!provided) {
    return res.status(401).json({ success: false, error: 'Missing X-Admin-Token header.' });
  }
  if (provided !== token) {
    return res.status(403).json({ success: false, error: 'Invalid admin token.' });
  }

  next();
}

/**
 * @openapi
 * /api/escrow/refresh:
 *   post:
 *     summary: Trigger a contract list refresh
 *     description: >
 *       Admin-only. Reads the current on-chain SCHEMA_VERSION of the
 *       LiquifactEscrow contract, compares it against the local version
 *       registry, and returns whether a refresh is needed.
 *       Requires the X-Admin-Token header.
 *     tags: [Admin, Escrow]
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Version check completed.
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
 *                     onChainVersion:
 *                       type: integer
 *                     semver:
 *                       type: string
 *                       nullable: true
 *                     isLatest:
 *                       type: boolean
 *                     latestKnown:
 *                       type: integer
 *                     refreshTriggered:
 *                       type: boolean
 *       401:
 *         description: Missing admin token.
 *       403:
 *         description: Invalid admin token.
 *       500:
 *         description: Version check failed.
 *       503:
 *         description: Admin access not configured.
 */
router.post('/refresh', adminAuth, async (req, res) => {
  try {
    const result = await escrowVersions.checkOnChainVersion();
    const refreshTriggered = !result.isLatest;

    if (refreshTriggered) {
      logger.info('LiquifactEscrow contract list refresh triggered', result);
      // Extension point: emit an event, enqueue a job, etc.
    }

    return res.json({
      success: true,
      data: { ...result, refreshTriggered },
    });
  } catch (err) {
    logger.error('Escrow version check failed', { error: err.message });
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
