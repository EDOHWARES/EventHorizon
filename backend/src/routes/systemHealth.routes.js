const express = require('express');
const router = express.Router();
const systemHealthController = require('../controllers/systemHealth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');

/**
 * @openapi
 * /api/admin/health/current:
 *   get:
 *     summary: Get current system health status
 *     description: Returns the current system health metrics
 *     tags: [Admin, System Health]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SystemHealth'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/health/current',
    authMiddleware,
    permissionMiddleware('view_system_health'),
    systemHealthController.getCurrentHealth
);

/**
 * @openapi
 * /api/admin/health/history:
 *   get:
 *     summary: Get system health history
 *     description: Returns historical system health metrics
 *     tags: [Admin, System Health]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *         description: Number of hours to look back
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of records to return
 *     responses:
 *       200:
 *         description: Health history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SystemHealth'
 */
router.get('/health/history',
    authMiddleware,
    permissionMiddleware('view_system_health'),
    systemHealthController.getHealthHistory
);

/**
 * @openapi
 * /api/admin/alerts/rules:
 *   post:
 *     summary: Create a new alert rule
 *     description: Create a new alert rule for system monitoring
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, alertType, conditions, notificationChannels]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               alertType:
 *                 type: string
 *                 enum: [high_failed_jobs, slow_api_response, db_unavailable, high_webhook_failures, webhook_rate_limited, external_service_down, high_error_rate, queue_backed_up, low_health_score, custom]
 *               severity:
 *                 type: string
 *                 enum: [info, warning, critical]
 *               conditions:
 *                 type: array
 *                 items:
 *                   type: object
 *               notificationChannels:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [slack, discord, email, webhook]
 *               slackConfig:
 *                 type: object
 *               discordConfig:
 *                 type: object
 *               emailConfig:
 *                 type: object
 *               webhookConfig:
 *                 type: object
 *               throttleConfig:
 *                 type: object
 *     responses:
 *       201:
 *         description: Alert rule created
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post('/alerts/rules',
    authMiddleware,
    permissionMiddleware('manage_alerts'),
    systemHealthController.createAlertRule
);

/**
 * @openapi
 * /api/admin/alerts/rules:
 *   get:
 *     summary: Get all alert rules
 *     description: Retrieve all alert rules for the organization
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by active status
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by enabled status
 *     responses:
 *       200:
 *         description: List of alert rules
 *       401:
 *         description: Unauthorized
 */
router.get('/alerts/rules',
    authMiddleware,
    permissionMiddleware('view_alerts'),
    systemHealthController.getAlertRules
);

/**
 * @openapi
 * /api/admin/alerts/rules/{ruleId}:
 *   get:
 *     summary: Get a specific alert rule
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Alert rule details
 *       404:
 *         description: Alert rule not found
 */
router.get('/alerts/rules/:ruleId',
    authMiddleware,
    permissionMiddleware('view_alerts'),
    systemHealthController.getAlertRule
);

/**
 * @openapi
 * /api/admin/alerts/rules/{ruleId}:
 *   put:
 *     summary: Update an alert rule
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Alert rule updated
 *       404:
 *         description: Alert rule not found
 */
router.put('/alerts/rules/:ruleId',
    authMiddleware,
    permissionMiddleware('manage_alerts'),
    systemHealthController.updateAlertRule
);

/**
 * @openapi
 * /api/admin/alerts/rules/{ruleId}:
 *   delete:
 *     summary: Delete an alert rule
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Alert rule deleted
 *       404:
 *         description: Alert rule not found
 */
router.delete('/alerts/rules/:ruleId',
    authMiddleware,
    permissionMiddleware('manage_alerts'),
    systemHealthController.deleteAlertRule
);

/**
 * @openapi
 * /api/admin/alerts/acknowledge/{ruleId}:
 *   post:
 *     summary: Acknowledge an alert
 *     description: Mark an alert as acknowledged
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Alert acknowledged
 *       404:
 *         description: Alert rule not found
 */
router.post('/alerts/acknowledge/:ruleId',
    authMiddleware,
    permissionMiddleware('manage_alerts'),
    systemHealthController.acknowledgeAlert
);

/**
 * @openapi
 * /api/admin/alerts/history:
 *   get:
 *     summary: Get alert history
 *     description: Retrieve alert history for the organization
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ruleId
 *         schema:
 *           type: string
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [info, warning, critical]
 *       - in: query
 *         name: acknowledged
 *         schema:
 *           type: string
 *           enum: [true, false]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Alert history
 */
router.get('/alerts/history',
    authMiddleware,
    permissionMiddleware('view_alerts'),
    systemHealthController.getAlertHistory
);

/**
 * @openapi
 * /api/admin/alerts/test/{ruleId}:
 *   post:
 *     summary: Test send an alert
 *     description: Send a test alert for a specific rule
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Test alert sent
 *       404:
 *         description: Alert rule or health data not found
 */
router.post('/alerts/test/:ruleId',
    authMiddleware,
    permissionMiddleware('manage_alerts'),
    systemHealthController.testAlert
);

/**
 * @openapi
 * /api/admin/alerts/initialize-defaults:
 *   post:
 *     summary: Initialize default alert rules
 *     description: Create default alert rules for the organization
 *     tags: [Admin, Alerts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Default alert rules created
 *       400:
 *         description: Alert rules already exist
 */
router.post('/alerts/initialize-defaults',
    authMiddleware,
    permissionMiddleware('manage_alerts'),
    systemHealthController.initializeDefaultAlerts
);

module.exports = router;
