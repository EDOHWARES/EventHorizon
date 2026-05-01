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

async function sendDiscordNotification(webhookUrl, payload, options = {}) {
    if (!webhookUrl) {
        throw new Error('Discord webhook URL is required.');
    }

    try {
        const response = await axios.post(webhookUrl, payload, {
            timeout: options.timeout || 30000,
            ...options,
        });

        return {
            success: true,
            status: response.status,
            data: response.data,
        };
    } catch (error) {
        if (error.response) {
            return {
                success: false,
                status: error.response.status,
                message: error.response.data,
            };
        }

        throw error;
    }
}

module.exports = {
    sendDiscordNotification,
};
const logger = require('../config/logger');

const sendDiscordNotification = async (webhookUrl, payload) => {
    logger.info('Mock discord notification', { webhookUrl, payload });
    // In real implementation this would use axios.post(webhookUrl, payload)
    return { success: true };
};

module.exports = {
    sendDiscordNotification
};
