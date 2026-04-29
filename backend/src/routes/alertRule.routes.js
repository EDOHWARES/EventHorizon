const express = require('express');
const router = express.Router();
const alertRuleController = require('../controllers/alertRule.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');
const auditMiddleware = require('../middleware/audit.middleware');
const validationMiddleware = require('../middleware/validation.middleware');

/**
 * @swagger
 * tags:
 *   name: Alert Rules
 *   description: Manage system health alert rules
 */

// GET /api/alerts/rules - List rules
router.get(
  '/',
  authMiddleware,
  permissionMiddleware('read_trigger'), // Reuse trigger permission or add 'manage_alerts'
  alertRuleController.getAlertRules
);

// POST /api/alerts/rules - Create rule
router.post(
  '/',
  authMiddleware,
  permissionMiddleware('create_trigger'),
  auditMiddleware.auditCreate(),
  validationMiddleware.validateBody({
    name: { required: true },
    description: {},
    alertType: { required: true, enum: ['high_failed_jobs', 'slow_api_response', 'db_unavailable', 'high_webhook_failures', 'webhook_rate_limited', 'external_service_down', 'high_error_rate', 'queue_backed_up', 'low_health_score', 'custom'] },
    severity: { enum: ['info', 'warning', 'critical'], default: 'warning' },
    conditions: { required: true, array: true },
    notificationChannels: { required: true, array: true, enum: ['slack', 'discord', 'email', 'webhook'] },
    slackConfig: {},
    throttleConfig: {}
  }),
  alertRuleController.createAlertRule
);

// GET /api/alerts/rules/:id - Get single rule
router.get(
  '/:id',
  authMiddleware,
  permissionMiddleware('read_trigger'),
  alertRuleController.getAlertRule
);

// PUT /api/alerts/rules/:id - Update rule
router.put(
  '/:id',
  authMiddleware,
  permissionMiddleware('update_trigger'),
  auditMiddleware.auditUpdate(),
  validationMiddleware.validateBody({
    name: {},
    description: {},
    // ... other updatable fields
  }),
  alertRuleController.updateAlertRule
);

// DELETE /api/alerts/rules/:id - Delete rule
router.delete(
  '/:id',
  authMiddleware,
  permissionMiddleware('delete_trigger'),
  auditMiddleware.auditDelete(),
  alertRuleController.deleteAlertRule
);

// POST /api/alerts/rules/:id/test - Test rule evaluation
router.post(
  '/:id/test',
  authMiddleware,
  permissionMiddleware('read_trigger'),
  alertRuleController.testAlertRule
);

// GET /api/alerts/history - Get alert history
router.get(
  '/history',
  authMiddleware,
  permissionMiddleware('read_trigger'),
  alertRuleController.getAlertHistory
);

module.exports = router;

