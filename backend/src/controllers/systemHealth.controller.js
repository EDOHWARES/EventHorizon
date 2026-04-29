const AlertRule = require('../models/alertRule.model');
const SystemHealth = require('../models/systemHealth.model');
const alertManagerService = require('../services/alertManager.service');
const systemHealthMonitorService = require('../services/systemHealthMonitor.service');
const logger = require('../config/logger');

/**
 * Controller for system health and alert management
 */
class SystemHealthController {
    /**
     * GET /api/admin/health/current
     * Get current system health status
     */
    async getCurrentHealth(req, res) {
        try {
            const { organizationId } = req.user;

            const health = await systemHealthMonitorService.getLatestHealth(organizationId);

            return res.json({
                success: true,
                data: health || { message: 'No health data available yet' }
            });
        } catch (error) {
            logger.error('Failed to get current health:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve health status'
            });
        }
    }

    /**
     * GET /api/admin/health/history
     * Get health history
     */
    async getHealthHistory(req, res) {
        try {
            const { organizationId } = req.user;
            const { hours = 24, limit = 100 } = req.query;

            const history = await systemHealthMonitorService.getHealthHistory(
                organizationId,
                parseInt(hours)
            );

            return res.json({
                success: true,
                data: history.slice(0, parseInt(limit))
            });
        } catch (error) {
            logger.error('Failed to get health history:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve health history'
            });
        }
    }

    /**
     * POST /api/admin/alerts/rules
     * Create a new alert rule
     */
    async createAlertRule(req, res) {
        try {
            const { organizationId, userId } = req.user;
            const {
                name,
                description,
                alertType,
                severity,
                conditions,
                notificationChannels,
                slackConfig,
                discordConfig,
                emailConfig,
                webhookConfig,
                throttleConfig,
            } = req.body;

            // Validate required fields
            if (!name || !alertType || !conditions || !notificationChannels) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: name, alertType, conditions, notificationChannels'
                });
            }

            const newRule = new AlertRule({
                organization: organizationId,
                createdBy: userId,
                name,
                description,
                alertType,
                severity: severity || 'warning',
                conditions,
                notificationChannels,
                slackConfig,
                discordConfig,
                emailConfig,
                webhookConfig,
                throttleConfig,
                isActive: true,
                isEnabled: true,
            });

            const saved = await newRule.save();

            return res.status(201).json({
                success: true,
                data: saved
            });
        } catch (error) {
            logger.error('Failed to create alert rule:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to create alert rule'
            });
        }
    }

    /**
     * GET /api/admin/alerts/rules
     * Get all alert rules for organization
     */
    async getAlertRules(req, res) {
        try {
            const { organizationId } = req.user;
            const { active, enabled } = req.query;

            const query = { organization: organizationId };
            if (active !== undefined) {
                query.isActive = active === 'true';
            }
            if (enabled !== undefined) {
                query.isEnabled = enabled === 'true';
            }

            const rules = await AlertRule.find(query).sort({ createdAt: -1 });

            return res.json({
                success: true,
                data: rules
            });
        } catch (error) {
            logger.error('Failed to get alert rules:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve alert rules'
            });
        }
    }

    /**
     * GET /api/admin/alerts/rules/:ruleId
     * Get a specific alert rule
     */
    async getAlertRule(req, res) {
        try {
            const { organizationId } = req.user;
            const { ruleId } = req.params;

            const rule = await AlertRule.findOne({
                _id: ruleId,
                organization: organizationId
            });

            if (!rule) {
                return res.status(404).json({
                    success: false,
                    error: 'Alert rule not found'
                });
            }

            return res.json({
                success: true,
                data: rule
            });
        } catch (error) {
            logger.error('Failed to get alert rule:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve alert rule'
            });
        }
    }

    /**
     * PUT /api/admin/alerts/rules/:ruleId
     * Update an alert rule
     */
    async updateAlertRule(req, res) {
        try {
            const { organizationId } = req.user;
            const { ruleId } = req.params;
            const updates = req.body;

            const rule = await AlertRule.findOneAndUpdate(
                {
                    _id: ruleId,
                    organization: organizationId
                },
                updates,
                { new: true, runValidators: true }
            );

            if (!rule) {
                return res.status(404).json({
                    success: false,
                    error: 'Alert rule not found'
                });
            }

            return res.json({
                success: true,
                data: rule
            });
        } catch (error) {
            logger.error('Failed to update alert rule:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to update alert rule'
            });
        }
    }

    /**
     * DELETE /api/admin/alerts/rules/:ruleId
     * Delete an alert rule
     */
    async deleteAlertRule(req, res) {
        try {
            const { organizationId } = req.user;
            const { ruleId } = req.params;

            const result = await AlertRule.deleteOne({
                _id: ruleId,
                organization: organizationId
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Alert rule not found'
                });
            }

            return res.json({
                success: true,
                message: 'Alert rule deleted successfully'
            });
        } catch (error) {
            logger.error('Failed to delete alert rule:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to delete alert rule'
            });
        }
    }

    /**
     * POST /api/admin/alerts/acknowledge/:ruleId
     * Acknowledge an alert
     */
    async acknowledgeAlert(req, res) {
        try {
            const { organizationId, userId } = req.user;
            const { ruleId } = req.params;

            // Verify the rule belongs to this organization
            const rule = await AlertRule.findOne({
                _id: ruleId,
                organization: organizationId
            });

            if (!rule) {
                return res.status(404).json({
                    success: false,
                    error: 'Alert rule not found'
                });
            }

            await alertManagerService.acknowledgeAlert(ruleId, userId);

            return res.json({
                success: true,
                message: 'Alert acknowledged successfully'
            });
        } catch (error) {
            logger.error('Failed to acknowledge alert:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to acknowledge alert'
            });
        }
    }

    /**
     * GET /api/admin/alerts/history
     * Get alert history
     */
    async getAlertHistory(req, res) {
        try {
            const { organizationId } = req.user;
            const { ruleId, severity, acknowledged, limit = 100 } = req.query;

            const filters = { limit: parseInt(limit) };
            if (ruleId) filters.ruleId = ruleId;
            if (severity) filters.severity = severity;
            if (acknowledged !== undefined) filters.acknowledged = acknowledged === 'true';

            const history = await alertManagerService.getAlertHistory(organizationId, filters);

            return res.json({
                success: true,
                data: history
            });
        } catch (error) {
            logger.error('Failed to get alert history:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve alert history'
            });
        }
    }

    /**
     * POST /api/admin/alerts/test/:ruleId
     * Test send an alert
     */
    async testAlert(req, res) {
        try {
            const { organizationId } = req.user;
            const { ruleId } = req.params;

            const rule = await AlertRule.findOne({
                _id: ruleId,
                organization: organizationId
            });

            if (!rule) {
                return res.status(404).json({
                    success: false,
                    error: 'Alert rule not found'
                });
            }

            // Get latest health metrics as test data
            const healthMetrics = await systemHealthMonitorService.getLatestHealth(organizationId);
            
            if (!healthMetrics) {
                return res.status(400).json({
                    success: false,
                    error: 'No health metrics available for testing'
                });
            }

            // Send test alert
            const results = await alertManagerService.sendAlertNotifications(
                [{ rule, healthSnapshot: healthMetrics }],
                organizationId
            );

            return res.json({
                success: true,
                message: 'Test alert sent',
                data: results
            });
        } catch (error) {
            logger.error('Failed to test alert:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to send test alert'
            });
        }
    }

    /**
     * POST /api/admin/alerts/initialize-defaults
     * Initialize default alert rules
     */
    async initializeDefaultAlerts(req, res) {
        try {
            const { organizationId, userId } = req.user;

            // Check if rules already exist
            const existingRules = await AlertRule.countDocuments({
                organization: organizationId
            });

            if (existingRules > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Alert rules already exist for this organization'
                });
            }

            const created = await alertManagerService.createDefaultAlertRules(
                organizationId,
                userId
            );

            return res.status(201).json({
                success: true,
                message: 'Default alert rules created',
                data: created
            });
        } catch (error) {
            logger.error('Failed to initialize default alerts:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to initialize default alerts'
            });
        }
    }
}

module.exports = new SystemHealthController();
