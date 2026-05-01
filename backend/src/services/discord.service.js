const axios = require('axios');
const logger = require('../config/logger');

const sendDiscordNotification = async (webhookUrl, payload) => {
    logger.info('Mock discord notification', { webhookUrl, payload });
    // In real implementation this would use axios.post(webhookUrl, payload)
    return { success: true };
};

module.exports = {
    sendDiscordNotification
};
