const logger = require('../config/logger');

const sendEventNotification = async ({ trigger, payload }) => {
    logger.info('Mock email notification', { triggerId: trigger._id, payload });
    return { success: true };
};

module.exports = {
    sendEventNotification
};
