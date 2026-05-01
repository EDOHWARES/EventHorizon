const express = require('express');
const router = express.Router();
const killSwitchController = require('../controllers/killSwitch.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');

/**
 * @openapi
 * /api/kill-switch:
 *   get:
 *     summary: Get kill switch status
 *     description: Retrieve the current kill switch configuration.
 *     tags:
 *       - Kill Switch
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Kill switch status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 global:
 *                   type: boolean
 *                 perOrganization:
 *                   type: object
 *                 perProvider:
 *                   type: object
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden - insufficient permissions.
 *       500:
 *         description: Internal server error.
 *   put:
 *     summary: Update kill switch
 *     description: Update the kill switch configuration to pause or resume actions.
 *     tags:
 *       - Kill Switch
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               global:
 *                 type: boolean
 *                 description: Global kill switch - pauses all actions when true
 *               perOrganization:
 *                 type: object
 *                 description: Organization-specific kill switches
 *               perProvider:
 *                 type: object
 *                 description: Provider-specific kill switches
 *     responses:
 *       200:
 *         description: Kill switch updated successfully.
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden - insufficient permissions.
 *       500:
 *         description: Internal server error.
 */

router.get(
  '/',
  authMiddleware,
  permissionMiddleware('manage_kill_switch'),
  killSwitchController.getKillSwitchStatus
);

router.put(
  '/',
  authMiddleware,
  permissionMiddleware('manage_kill_switch'),
  killSwitchController.updateKillSwitch
);

module.exports = router;