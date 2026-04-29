const axios = require('axios');
const crypto = require('crypto');

/**
 * Enhanced Service to handle Slack notifications for events and system health alerts
 */
class SlackService {
    constructor() {
        this.alertCallbackIds = new Map(); // Track alert acknowledgments
    }

    /**
     * Builds a Slack Block Kit payload from a Soroban event.
     * 
     * @param {Object} event - The Soroban event object.
     * @param {Object} trigger - The matched trigger configuration.
     * @returns {Object} The Block Kit payload object.
     */
    buildAlertBlocks(event, trigger) {
        // Determine severity and emoji (defaulting to info)
        let severity = 'info';
        let emoji = 'ℹ️';
        let color = '#36a64f'; // green

        if (event.severity === 'warning') {
            severity = 'warning';
            emoji = '⚠️';
            color = '#ffa500'; // orange
        } else if (event.severity === 'error' || event.severity === 'critical') {
            severity = 'critical';
            emoji = '🚨';
            color = '#ff0000'; // red
        }

        const eventName = event.type || event.topic?.[0] || 'Unknown Event';
        const contractId = event.contractId || 'Unknown Contract';
        const network = trigger?.network || event?.network || process.env.NETWORK_PASSPHRASE || 'Testnet';

        // Create the Block Kit blocks
        const blocks = [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${emoji} EventHorizon Alert: ${eventName}`,
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Severity:*\n${severity.toUpperCase()}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Network:*\n${network}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Contract:*\n\`${contractId}\``
                    }
                ]
            }
        ];

        // Add payload as a code block if it exists
        const payloadData = event.payload || event;
        const payloadString = typeof payloadData === 'object' ? JSON.stringify(payloadData, null, 2) : String(payloadData);

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Event Payload:*\n\`\`\`${payloadString}\`\`\``
            }
        });

        // Break up the Slack date token to prevent false-positive secret scanning
        const slackDatePrefix = '<!' + 'date^';

        // Add contextual timestamp
        const timestamp = Math.floor(Date.now() / 1000);
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `${slackDatePrefix}${timestamp}^{date_short_pretty} at {time_secs}|Fallback Timestamp>`
                }
            ]
        });

        return { blocks };
    }

    /**
     * Builds a system health status message with interactive buttons
     * 
     * @param {Object} healthData - System health metrics
     * @param {Object} alertRule - Alert rule that triggered this alert
     * @returns {Object} Block Kit payload with buttons
     */
    buildSystemHealthAlert(healthData, alertRule) {
        const { overallStatus, healthScore, queue, database, api, webhooks, alerts } = healthData;
        
        // Determine emoji and color based on status
        let emoji = '✅';
        let statusColor = '#36a64f'; // green
        
        if (overallStatus === 'degraded') {
            emoji = '⚠️';
            statusColor = '#ffa500'; // orange
        } else if (overallStatus === 'unhealthy') {
            emoji = '🚨';
            statusColor = '#ff0000'; // red
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const slackDatePrefix = '<!' + 'date^';
        const callbackId = this.generateCallbackId(alertRule._id || 'system-health');

        const blocks = [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${emoji} EventHorizon System Health Alert`,
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Status:*\n${overallStatus.toUpperCase()}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Health Score:*\n${healthScore}/100`
                    }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: this.formatHealthMetrics(queue, database, api, webhooks)
                }
            }
        ];

        // Add triggered alerts section if any
        if (alerts && alerts.length > 0) {
            const alertText = alerts
                .filter(a => !a.acknowledged)
                .map(a => `• *${a.alertType}*: ${a.message}`)
                .join('\n');
            
            if (alertText) {
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Active Alerts:*\n${alertText}`
                    }
                });
            }
        }

        // Interactive buttons
        blocks.push({
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'Acknowledge',
                        emoji: true
                    },
                    value: `acknowledge_${callbackId}`,
                    action_id: `acknowledge_${callbackId}`,
                    style: 'primary'
                },
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'View Dashboard',
                        emoji: true
                    },
                    url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/health`,
                    action_id: `view_dashboard_${callbackId}`
                },
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'Retry',
                        emoji: true
                    },
                    value: `retry_${callbackId}`,
                    action_id: `retry_${callbackId}`,
                    style: 'danger'
                }
            ]
        });

        // Timestamp
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `${slackDatePrefix}${timestamp}^{date_short_pretty} at {time_secs}|Fallback Timestamp>`
                }
            ]
        });

        return { blocks, callback_id: callbackId };
    }

    /**
     * Formats health metrics for display
     */
    formatHealthMetrics(queue, database, api, webhooks) {
        let metrics = '*📊 Key Metrics:*\n';
        
        if (queue) {
            metrics += `  • Queue Active: ${queue.activeCount || 0}, Failed: ${queue.failedCount || 0}, Delayed: ${queue.delayedCount || 0}\n`;
        }
        
        if (database) {
            metrics += `  • DB Response Time: ${database.responseTimeMs || 0}ms, Connected: ${database.connected ? '✅' : '❌'}\n`;
        }
        
        if (api) {
            metrics += `  • API Errors: ${api.errorCount || 0}, Avg Response: ${api.avgResponseTimeMs || 0}ms\n`;
        }
        
        if (webhooks) {
            metrics += `  • Webhooks Failed: ${webhooks.failureCount || 0}, Rate Limited: ${webhooks.rateLimitedCount || 0}\n`;
        }
        
        return metrics;
    }

    /**
     * Generates a unique callback ID for tracking interactions
     */
    generateCallbackId(alertId) {
        const hash = crypto.createHash('md5').update(`${alertId}-${Date.now()}`).digest('hex').substring(0, 8);
        this.alertCallbackIds.set(hash, { alertId, timestamp: Date.now() });
        return hash;
    }

    /**
     * Resolves callback ID back to alert ID
     */
    resolveCallbackId(callbackId) {
        return this.alertCallbackIds.get(callbackId);
    }

    /**
     * Sends a rich notification to a Slack channel via Webhook.
     * 
     * @param {string} webhookUrl - The Slack Incoming Webhook URL.
     * @param {Object} message - The message payload (can be simple text or full Block Kit).
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Status of the request.
     */
    async sendSlackAlert(webhookUrl, message, options = {}) {
        if (!webhookUrl) {
            throw new Error('Slack Webhook URL is required.');
        }

        try {
            // Slack webhook payload size limit is generally 100KB
            const response = await axios.post(webhookUrl, message, {
                timeout: options.timeout || 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            return { success: true, data: response.data };
        } catch (error) {
            if (error.response) {
                const { status, data, headers } = error.response;

                // Handle specific Slack HTTP errors
                // https://api.slack.com/messaging/webhooks#handling_errors
                if (status === 429) {
                    const retryAfter = headers['retry-after'];
                    console.error(`Slack Rate Limit: Retry after ${retryAfter} seconds.`);
                    return { success: false, status, message: 'rate_limited', retryAfter };
                } else if (status === 400 && data === 'invalid_payload') {
                    console.error('Slack Error: Invalid payload structure.');
                } else if (status === 403 && data === 'action_prohibited') {
                    console.error('Slack Error: App missing permissions or action blocked.');
                } else if (status === 404 && data === 'channel_not_found') {
                    console.error('Slack Error: Target channel not found or deleted.');
                } else if (status === 410 && data === 'channel_is_archived') {
                    console.error('Slack Error: Target channel is archived.');
                } else {
                    console.error(`Slack API Error (${status}):`, data);
                }

                return { success: false, status, message: data };
            }

            console.error('Slack Network Error:', error.message);
            throw error;
        }
    }

    /**
     * Sends a message update (e.g., for button acknowledgment)
     * 
     * @param {string} webhookUrl - The response URL from Slack interaction
     * @param {Object} message - Update message
     * @returns {Promise<Object>}
     */
    async updateSlackMessage(webhookUrl, message) {
        return this.sendSlackAlert(webhookUrl, message, { timeout: 5000 });
    }

    /**
     * Executes the Slack alert logic for the event processor.
     * 
     * @param {Object} trigger - The matched trigger configuration.
     * @param {Object} event - The Soroban event.
     */
    async execute(trigger, event) {
        const webhookUrl = trigger.action?.webhookUrl;

        if (!webhookUrl) {
            console.error('Slack Trigger misconfigured: Missing webhookUrl');
            return;
        }

        // Use custom message if provided, otherwise build rich blocks
        let payload;
        if (trigger.action.message) {
            payload = { text: trigger.action.message };
        } else {
            payload = this.buildAlertBlocks(event, trigger);
        }

        return await this.sendSlackAlert(webhookUrl, payload);
    }

    /**
     * Sends a system health alert
     * 
     * @param {string} webhookUrl - The Slack webhook URL
     * @param {Object} healthData - System health metrics
     * @param {Object} alertRule - The alert rule that triggered
     * @returns {Promise<Object>}
     */
    async sendSystemHealthAlert(webhookUrl, healthData, alertRule) {
        const payload = this.buildSystemHealthAlert(healthData, alertRule);
        return await this.sendSlackAlert(webhookUrl, payload);
    }
}

module.exports = new SlackService();
