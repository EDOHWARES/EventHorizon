const AlertRule = require('../models/alertRule.model');
const SystemHealth = require('../models/systemHealth.model');
const slackService = require('./slack.service');
const logger = require('../config/logger');

/**
 * Service to manage and evaluate alert rules
 */
class AlertManagerService {
    /**
     * Evaluates all active alert rules for an organization
     * @param {String} organizationId - Organization ID
     * @param {Object} healthMetrics - Current health metrics
     * @returns {Promise<Array>} Triggered alerts
     */
    async evaluateAlerts(organizationId, healthMetrics) {
        try {
            // Get all active alert rules
            const rules = await AlertRule.find({
                organization: organizationId,
                isActive: true,
                isEnabled: true,
            });

            const triggeredAlerts = [];

            for (const rule of rules) {
                const shouldTrigger = await this.evaluateRule(rule, healthMetrics);
                
                if (shouldTrigger) {
                    // Check throttling
                    if (await this.shouldThrottle(rule)) {
                        logger.info(`Alert rule throttled: ${rule._id}`);
                        continue;
                    }

                    triggeredAlerts.push({
                        rule,
                        healthSnapshot: JSON.parse(JSON.stringify(healthMetrics)),
                    });

                    // Update rule's last triggered time
                    await AlertRule.updateOne(
                        { _id: rule._id },
                        { lastTriggeredAt: new Date(), triggerCount: rule.triggerCount + 1 }
                    );
                }
            }

            return triggeredAlerts;
        } catch (error) {
            logger.error('Failed to evaluate alerts:', error.message);
            return [];
        }
    }

    /**
     * Evaluates a single alert rule against health metrics
     * @param {Object} rule - Alert rule
     * @param {Object} healthMetrics - Health metrics
     * @returns {Promise<Boolean>} Whether rule condition is met
     */
    async evaluateRule(rule, healthMetrics) {
        try {
            // Evaluate all conditions (all must be true)
            for (const condition of rule.conditions) {
                if (!this.evaluateCondition(condition, healthMetrics)) {
                    return false;
                }
            }

            return true;
        } catch (error) {
            logger.error(`Error evaluating rule ${rule._id}:`, error.message);
            return false;
        }
    }

    /**
     * Evaluates a single condition
     * @param {Object} condition - Condition object
     * @param {Object} healthMetrics - Health metrics
     * @returns {Boolean} Whether condition is met
     */
    evaluateCondition(condition, healthMetrics) {
        const { metric, operator, value, serviceName } = condition;

        // Get the metric value from health data
        const metricValue = this.getMetricValue(metric, healthMetrics, serviceName);

        if (metricValue === null || metricValue === undefined) {
            return false;
        }

        // Evaluate operator
        switch (operator) {
            case 'gt':
                return metricValue > value;
            case 'gte':
                return metricValue >= value;
            case 'lt':
                return metricValue < value;
            case 'lte':
                return metricValue <= value;
            case 'eq':
                return metricValue === value;
            case 'neq':
                return metricValue !== value;
            case 'in':
                return Array.isArray(value) && value.includes(metricValue);
            case 'contains':
                return typeof metricValue === 'string' && metricValue.includes(value);
            default:
                return false;
        }
    }

    /**
     * Gets a metric value from health data using dot notation
     * @param {String} path - Dot notation path (e.g., 'queue.failedCount')
     * @param {Object} data - Health data
     * @param {String} serviceName - Service name for external services
     * @returns {*} Metric value
     */
    getMetricValue(path, data, serviceName = null) {
        if (path.startsWith('externalServices.')) {
            // Handle external services array
            const parts = path.split('.');
            const property = parts[2]; // e.g., 'status'
            
            if (data.externalServices && Array.isArray(data.externalServices)) {
                const service = data.externalServices.find(s => s.name === serviceName);
                if (service && service[property] !== undefined) {
                    return service[property];
                }
            }
            return null;
        }

        // Standard dot notation path traversal
        let value = data;
        const parts = path.split('.');
        
        for (const part of parts) {
            if (value && typeof value === 'object') {
                value = value[part];
            } else {
                return null;
            }
        }

        return value;
    }

    /**
     * Checks if an alert should be throttled
     * @param {Object} rule - Alert rule
     * @returns {Promise<Boolean>} Whether alert should be throttled
     */
    async shouldThrottle(rule) {
        if (!rule.throttleConfig || !rule.throttleConfig.enabled) {
            return false;
        }

        if (!rule.lastTriggeredAt) {
            return false;
        }

        const minInterval = rule.throttleConfig.minIntervalMinutes * 60 * 1000;
        const timeSinceLastTrigger = Date.now() - new Date(rule.lastTriggeredAt).getTime();

        return timeSinceLastTrigger < minInterval;
    }

    /**
     * Sends notifications for triggered alerts
     * @param {Array} triggeredAlerts - Array of triggered alerts
     * @param {String} organizationId - Organization ID
     * @returns {Promise<Array>} Notification results
     */
    async sendAlertNotifications(triggeredAlerts, organizationId) {
        const results = [];

        for (const { rule, healthSnapshot } of triggeredAlerts) {
            try {
                const notificationResults = await this.sendAlertViaChannels(
                    rule,
                    healthSnapshot,
                    organizationId
                );

                results.push({
                    ruleId: rule._id,
                    ruleName: rule.name,
                    notificationResults,
                    status: 'sent',
                });

                // Add alert to health record
                if (healthSnapshot) {
                    await this.recordAlertInHealth(organizationId, rule, healthSnapshot);
                }
            } catch (error) {
                logger.error(`Failed to send alert for rule ${rule._id}:`, error.message);
                results.push({
                    ruleId: rule._id,
                    ruleName: rule.name,
                    status: 'failed',
                    error: error.message,
                });
            }
        }

        return results;
    }

    /**
     * Sends alert via configured notification channels
     * @param {Object} rule - Alert rule
     * @param {Object} healthSnapshot - Health metrics snapshot
     * @param {String} organizationId - Organization ID
     * @returns {Promise<Object>} Notification results
     */
    async sendAlertViaChannels(rule, healthSnapshot, organizationId) {
        const results = {};

        for (const channel of rule.notificationChannels) {
            try {
                switch (channel) {
                    case 'slack':
                        results.slack = await this.sendSlackAlert(rule, healthSnapshot);
                        break;
                    case 'discord':
                        // TODO: Implement Discord alerts
                        results.discord = { status: 'not_implemented' };
                        break;
                    case 'email':
                        // TODO: Implement Email alerts
                        results.email = { status: 'not_implemented' };
                        break;
                    case 'webhook':
                        results.webhook = await this.sendWebhookAlert(rule, healthSnapshot);
                        break;
                }
            } catch (error) {
                logger.error(`Failed to send ${channel} alert:`, error.message);
                results[channel] = { status: 'failed', error: error.message };
            }
        }

        return results;
    }

    /**
     * Sends alert via Slack
     * @param {Object} rule - Alert rule
     * @param {Object} healthSnapshot - Health snapshot
     * @returns {Promise<Object>} Result
     */
    async sendSlackAlert(rule, healthSnapshot) {
        if (!rule.slackConfig || !rule.slackConfig.webhookUrl) {
            throw new Error('Slack webhook URL not configured');
        }

        const result = await slackService.sendSystemHealthAlert(
            rule.slackConfig.webhookUrl,
            healthSnapshot,
            rule
        );

        return { status: result.success ? 'sent' : 'failed', ...result };
    }

    /**
     * Sends alert via webhook
     * @param {Object} rule - Alert rule
     * @param {Object} healthSnapshot - Health snapshot
     * @returns {Promise<Object>} Result
     */
    async sendWebhookAlert(rule, healthSnapshot) {
        if (!rule.webhookConfig || !rule.webhookConfig.url) {
            throw new Error('Webhook URL not configured');
        }

        const axios = require('axios');
        const payload = {
            alertType: rule.alertType,
            severity: rule.severity,
            message: rule.description,
            healthMetrics: healthSnapshot,
            timestamp: new Date().toISOString(),
        };

        try {
            const response = await axios.post(rule.webhookConfig.url, payload, {
                headers: rule.webhookConfig.headers || {},
                timeout: 10000,
            });

            return { status: 'sent', data: response.data };
        } catch (error) {
            return { status: 'failed', error: error.message };
        }
    }

    /**
     * Records alert in system health history
     * @param {String} organizationId - Organization ID
     * @param {Object} rule - Alert rule
     * @param {Object} healthSnapshot - Health snapshot
     * @returns {Promise<void>}
     */
    async recordAlertInHealth(organizationId, rule, healthSnapshot) {
        try {
            await SystemHealth.updateOne(
                { organization: organizationId, _id: healthSnapshot._id || null },
                {
                    $push: {
                        alerts: {
                            ruleId: rule._id,
                            alertType: rule.alertType,
                            severity: rule.severity,
                            message: rule.description,
                            triggeredAt: new Date(),
                            acknowledged: false,
                        }
                    }
                },
                { upsert: false }
            );
        } catch (error) {
            logger.error('Failed to record alert in health:', error.message);
        }
    }

    /**
     * Acknowledges an alert
     * @param {String} ruleId - Alert rule ID
     * @param {String} userId - User ID
     * @returns {Promise<void>}
     */
    async acknowledgeAlert(ruleId, userId) {
        try {
            await AlertRule.updateOne(
                { _id: ruleId },
                {
                    lastAcknowledgedAt: new Date(),
                    acknowledgedCount: { $inc: 1 }
                }
            );

            // Update health records
            await SystemHealth.updateMany(
                { 'alerts.ruleId': ruleId, 'alerts.acknowledged': false },
                {
                    $set: {
                        'alerts.$.acknowledged': true,
                        'alerts.$.acknowledgedAt': new Date(),
                        'alerts.$.acknowledgedBy': userId,
                    }
                }
            );
        } catch (error) {
            logger.error('Failed to acknowledge alert:', error.message);
            throw error;
        }
    }

    /**
     * Gets alert history for organization
     * @param {String} organizationId - Organization ID
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} Alert history
     */
    async getAlertHistory(organizationId, filters = {}) {
        try {
            const query = { organization: organizationId };
            
            if (filters.ruleId) {
                query.ruleId = filters.ruleId;
            }
            
            if (filters.severity) {
                query.severity = filters.severity;
            }
            
            if (filters.acknowledged !== undefined) {
                query.acknowledged = filters.acknowledged;
            }

            const alerts = await SystemHealth.find(
                query,
                { alerts: 1, timestamp: 1 },
                { sort: { timestamp: -1 }, limit: filters.limit || 100 }
            );

            return alerts;
        } catch (error) {
            logger.error('Failed to get alert history:', error.message);
            return [];
        }
    }

    /**
     * Creates a default set of alert rules for an organization
     * @param {String} organizationId - Organization ID
     * @param {String} userId - Creator user ID
     * @returns {Promise<Array>} Created rules
     */
    async createDefaultAlertRules(organizationId, userId) {
        const defaultRules = [
            {
                organization: organizationId,
                createdBy: userId,
                name: 'High Failed Jobs',
                description: 'Alert when failed job count exceeds 50',
                alertType: 'high_failed_jobs',
                severity: 'warning',
                conditions: [
                    {
                        metric: 'queue.failedCount',
                        operator: 'gt',
                        value: 50,
                    }
                ],
                notificationChannels: ['slack'],
                isActive: true,
                isEnabled: true,
            },
            {
                organization: organizationId,
                createdBy: userId,
                name: 'Database Unavailable',
                description: 'Alert when database is not connected',
                alertType: 'db_unavailable',
                severity: 'critical',
                conditions: [
                    {
                        metric: 'database.connected',
                        operator: 'eq',
                        value: false,
                    }
                ],
                notificationChannels: ['slack'],
                isActive: true,
                isEnabled: true,
            },
            {
                organization: organizationId,
                createdBy: userId,
                name: 'High Webhook Failures',
                description: 'Alert when webhook failure count exceeds 20',
                alertType: 'high_webhook_failures',
                severity: 'warning',
                conditions: [
                    {
                        metric: 'webhooks.failureCount',
                        operator: 'gt',
                        value: 20,
                    }
                ],
                notificationChannels: ['slack'],
                isActive: true,
                isEnabled: true,
            },
            {
                organization: organizationId,
                createdBy: userId,
                name: 'Slow API Response',
                description: 'Alert when average API response time exceeds 2 seconds',
                alertType: 'slow_api_response',
                severity: 'warning',
                conditions: [
                    {
                        metric: 'api.avgResponseTimeMs',
                        operator: 'gt',
                        value: 2000,
                    }
                ],
                notificationChannels: ['slack'],
                isActive: true,
                isEnabled: true,
            },
            {
                organization: organizationId,
                createdBy: userId,
                name: 'Low Health Score',
                description: 'Alert when health score drops below 50',
                alertType: 'low_health_score',
                severity: 'critical',
                conditions: [
                    {
                        metric: 'healthScore',
                        operator: 'lt',
                        value: 50,
                    }
                ],
                notificationChannels: ['slack'],
                isActive: true,
                isEnabled: true,
            },
        ];

        try {
            const created = await AlertRule.insertMany(defaultRules);
            return created;
        } catch (error) {
            logger.error('Failed to create default alert rules:', error.message);
            return [];
        }
    }
}

module.exports = new AlertManagerService();
