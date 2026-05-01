const Trigger = require('../models/trigger.model');
const webhookService = require('./webhook.service');
const discordService = require('./discord.service');
const telegramService = require('./telegram.service');
const emailService = require('./email.service');
const slackService = require('./slack.service');
const logger = require('../config/logger');

/**
 * Health service for monitoring trigger connectivity and status
 */
class HealthService {
    /**
     * Run health checks for all eligible triggers
     */
    async runAllHealthChecks() {
        const now = new Date();
        
        // Find active triggers that are due for a health check
        const triggers = await Trigger.find({
            isActive: true,
            'healthCheckConfig.enabled': true,
            $or: [
                { lastHealthCheckAt: { $exists: false } },
                { 
                    $expr: { 
                        $gt: [
                            { $subtract: [now, '$lastHealthCheckAt'] }, 
                            '$healthCheckConfig.intervalMs'
                        ] 
                    } 
                }
            ]
        }).populate('createdBy');

        logger.info(`Starting health check cycle for ${triggers.length} triggers`);

        const results = {
            total: triggers.length,
            successful: 0,
            failed: 0
        };

        for (const trigger of triggers) {
            try {
                await this.checkTriggerHealth(trigger);
                results.successful++;
            } catch (error) {
                results.failed++;
                logger.error(`Health check failed for trigger ${trigger._id}`, {
                    error: error.message
                });
            }
        }

        logger.info('Health check cycle completed', results);
        return results;
    }

    /**
     * Perform a health check for a single trigger
     * @param {object} trigger - The trigger to check
     */
    async checkTriggerHealth(trigger) {
        const { actionType, actionUrl, contractId, eventName } = trigger;
        
        logger.debug(`Running health check for trigger ${trigger._id}`, {
            actionType,
            contractId,
            eventName
        });

        const healthCheckPayload = {
            isHealthCheck: true,
            timestamp: new Date().toISOString(),
            source: 'EventHorizon Health Monitor',
            message: 'This is an automated connectivity test. No action is required.'
        };

        try {
            switch (actionType) {
                case 'webhook':
                    await webhookService.sendSignedWebhook(
                        actionUrl,
                        healthCheckPayload,
                        trigger.webhookSecret,
                        { 
                            organizationId: trigger.organization,
                            headers: { 'X-EventHorizon-Health-Check': 'true' },
                            timeout: 10000 // Shorter timeout for health checks
                        }
                    );
                    break;

                case 'discord':
                    await discordService.sendDiscordNotification(actionUrl, {
                        embeds: [{
                            title: '🔄 EventHorizon Health Check',
                            description: 'Connectivity test successful.',
                            color: 0x00FF00,
                            timestamp: new Date().toISOString()
                        }]
                    });
                    break;

                case 'telegram':
                    await telegramService.sendTelegramMessage(
                        process.env.TELEGRAM_BOT_TOKEN,
                        actionUrl,
                        '🔄 *EventHorizon Health Check*: Connectivity test successful.'
                    );
                    break;

                case 'email':
                    await emailService.sendEmail({
                        to: trigger.createdBy.email,
                        subject: 'EventHorizon Health Check',
                        text: 'Your trigger connectivity test was successful.'
                    });
                    break;

                case 'slack':
                    await slackService.execute(trigger, healthCheckPayload, { isHealthCheck: true });
                    break;

                default:
                    throw new Error(`Unsupported action type for health check: ${actionType}`);
            }

            // Update health check timestamp
            trigger.lastHealthCheckAt = new Date();
            // We don't reset consecutiveFailures here because this is just a No-Op check.
            // However, a successful No-Op check is a good sign.
            await trigger.save();

        } catch (error) {
            // Handle failure
            const { autoDisabled } = await trigger.handleFailure(error);
            
            if (autoDisabled) {
                logger.warn(`Trigger auto-disabled due to failed health check`, {
                    triggerId: trigger._id,
                    consecutiveFailures: trigger.consecutiveFailures
                });

                // Notify owner
                await emailService.sendFailureNotification(
                    trigger, 
                    `Health check failed: ${error.message}. Trigger has been automatically disabled after ${trigger.consecutiveFailures} consecutive failures.`
                );
            }
            
            throw error;
        }
    }
}

module.exports = new HealthService();
