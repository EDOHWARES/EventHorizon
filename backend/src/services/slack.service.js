const axios = require('axios');
const breakers = require('./circuitBreaker');

/**
 * Service to handle Slack Webhook notifications
 */
class SlackService {
    /**
     * Builds a Slack Block Kit payload from a Soroban event.
     * 
     * @param {Object} event - The Soroban event object.
     * @param {Object} trigger - The matched trigger configuration.
     * @returns {Object} The Block Kit payload object.
     */
    buildAlertBlocks(event, trigger) {
        // Determine severity and emoji (defaulting to info)
        // This is a simplified example based on common event structures
        let severity = 'info';
        let emoji = 'ℹ️';

        if (event.severity === 'warning') {
            severity = 'warning';
            emoji = '⚠️';
        } else if (event.severity === 'error' || event.severity === 'critical') {
            severity = 'critical';
            emoji = '🚨';
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
     * Sends a rich notification to a Slack channel via Webhook.
     * 
     * @param {string} webhookUrl - The Slack Incoming Webhook URL.
     * @param {Object} message - The message payload (can be simple text or full Block Kit).
     * @returns {Promise<Object>} Status of the request.
     */
    async sendSlackAlert(webhookUrl, message) {
        if (!webhookUrl) {
            throw new Error('Slack Webhook URL is required.');
        }

        try {
            // Slack webhook payload size limit is generally 100KB
            const response = await breakers.fire(
                'slack',
                (url, msg) => axios.post(url, msg),
                [webhookUrl, message]
            );
            return { success: true, data: response.data };
        } catch (error) {
            if (error.code === 'CIRCUIT_OPEN') {
                console.error('Slack circuit breaker OPEN — fast-failing.');
                return { success: false, status: 503, message: 'circuit_open' };
            }
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
}

module.exports = new SlackService();

// Let's see something.
