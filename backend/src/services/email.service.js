const logger = require('../config/logger');

/**
 * Email service for sending notifications
 * Note: In a production environment, this would use nodemailer, SendGrid, etc.
 */
class EmailService {
    /**
     * Send a general email
     * @param {object} options - Email options (to, subject, text, html)
     */
    async sendEmail(options) {
        const { to, subject, text, html } = options;

        // Mock sending email
        logger.info('Sending email notification', {
            to,
            subject,
            textSnippet: text ? text.substring(0, 50) + '...' : 'none',
        });

        // Simulate network delay
        return new Promise((resolve) => {
            setTimeout(() => {
                logger.debug('Email sent successfully', { to, subject });
                resolve({ success: true, messageId: `mock-${Date.now()}` });
            }, 100);
        });
    }

    /**
     * Send event notification to trigger owner
     * @param {object} params - Notification parameters
     */
    async sendEventNotification({ trigger, payload }) {
        const owner = trigger.createdBy;
        if (!owner || !owner.email) {
            logger.warn('Cannot send event notification: trigger owner has no email', {
                triggerId: trigger._id
            });
            return;
        }

        const subject = `EventHorizon: Trigger "${trigger.eventName}" Fired`;
        const text = `The trigger for contract ${trigger.contractId} and event ${trigger.eventName} was executed successfully.\n\nPayload:\n${JSON.stringify(payload, null, 2)}`;

        return this.sendEmail({
            to: owner.email,
            subject,
            text,
        });
    }

    /**
     * Send failure notification to trigger owner
     * @param {object} trigger - The failing trigger
     * @param {string} reason - Reason for failure
     */
    async sendFailureNotification(trigger, reason) {
        const owner = trigger.createdBy;
        if (!owner || !owner.email) {
            logger.warn('Cannot send failure notification: trigger owner has no email', {
                triggerId: trigger._id
            });
            return;
        }

        const subject = `⚠️ EventHorizon: Trigger "${trigger.eventName}" FAILED`;
        const text = `The trigger for contract ${trigger.contractId} and event ${trigger.eventName} has failed.\n\nReason: ${reason}\n\nConsecutive Failures: ${trigger.consecutiveFailures}\nStatus: ${trigger.isActive ? 'Active' : 'DISABLED'}`;

        return this.sendEmail({
            to: owner.email,
            subject,
            text,
        });
    }
}

module.exports = new EmailService();
const sendEventNotification = async ({ trigger, payload }) => {
    logger.info('Mock email notification', { triggerId: trigger._id, payload });
    return { success: true };
};

module.exports = {
    sendEventNotification
};
