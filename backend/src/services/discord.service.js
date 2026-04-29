const axios = require('axios');
const logger = require('../config/logger');

/**
 * Discord service for sending webhook notifications
 */
class DiscordService {
    /**
     * Send notification to Discord via webhook
     * @param {string} webhookUrl - Discord webhook URL
     * @param {object} payload - Discord embed/message payload
     */
    async sendDiscordNotification(webhookUrl, payload) {
        if (!webhookUrl) {
            throw new Error('Discord webhook URL is required');
        }

        logger.info('Sending Discord notification', {
            webhookUrl: webhookUrl.substring(0, 30) + '...',
            payloadKeys: Object.keys(payload)
        });

        try {
            const response = await axios.post(webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 10000, // 10 second timeout
            });

            logger.debug('Discord notification sent successfully', {
                status: response.status
            });

            return response.data;
        } catch (error) {
            logger.error('Failed to send Discord notification', {
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }
}

module.exports = new DiscordService();
