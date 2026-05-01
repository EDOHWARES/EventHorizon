const axios = require('axios');

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
