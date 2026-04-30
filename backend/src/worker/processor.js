const { Worker } = require('bullmq');
const Redis = require('ioredis');
const axios = require('axios');
const { sendEventNotification } = require('../services/email.service');
const { sendDiscordNotification } = require('../services/discord.service');
const telegramService = require('../services/telegram.service');
const webhookService = require('../services/webhook.service');
const logger = require('../config/logger');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 5);

const connection = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: null,
});

/**
 * Execute the action based on the trigger type
 */
async function executeAction(job) {
    const { trigger, eventPayload, eventPayloads, isBatch } = job.data;
    const { actionType, actionUrl, contractId, eventName } = trigger;

    const batchSize = isBatch ? eventPayloads.length : 1;

    logger.info('Processing action job', {
        jobId: job.id,
        actionType,
        contractId,
        eventName,
        isBatch,
        batchSize,
        attempt: job.attemptsMade + 1,
    });

    if (isBatch) {
        return await executeBatchAction(trigger, eventPayloads);
    } else {
        return await executeSingleAction(trigger, eventPayload);
    }
}

/**
 * Execute a single action
 */
async function executeSingleAction(trigger, eventPayload) {
    const { actionType, actionUrl, contractId, eventName } = trigger;

    switch (actionType) {
        case 'email': {
            return await sendEventNotification({
                trigger,
                payload: eventPayload,
            });
        }

        case 'discord': {
            if (!actionUrl) {
                throw new Error('Missing actionUrl for Discord trigger');
            }

            const discordPayload = {
                embeds: [{
                    title: `Event: ${eventName}`,
                    description: `Contract: ${contractId}`,
                    fields: [
                        {
                            name: 'Payload',
                            value: `\`\`\`json\n${JSON.stringify(eventPayload, null, 2).slice(0, 1000)}\n\`\`\``,
                        },
                    ],
                    color: 0x5865F2,
                    timestamp: new Date().toISOString(),
                }],
            };

            return await sendDiscordNotification(actionUrl, discordPayload);
        }

        case 'telegram': {
            const { botToken, chatId } = trigger;
            if (!botToken || !chatId) {
                throw new Error('Missing botToken or chatId for Telegram trigger');
            }

            const message = `🔔 *Event Triggered*\n\n` +
                `*Event:* ${telegramService.escapeMarkdownV2(eventName)}\n` +
                `*Contract:* \`${contractId}\`\n\n` +
                `*Payload:*\n\`\`\`\n${JSON.stringify(eventPayload, null, 2)}\n\`\`\``;

            return await telegramService.sendTelegramMessage(botToken, chatId, message);
        }

        case 'webhook': {
            if (!actionUrl) {
                throw new Error('Missing actionUrl for webhook trigger');
            }

            const payload = {
                contractId,
                eventName,
                payload: eventPayload,
            };

            return await webhookService.sendSignedWebhook(
                actionUrl,
                payload,
                trigger.webhookSecret,
                { organizationId: trigger.organization }
            );
        }

        default:
            throw new Error(`Unsupported action type: ${actionType}`);
    }
}

/**
 * Execute a batch action with error handling for individual events
 */
async function executeBatchAction(trigger, eventPayloads) {
    const { actionType, actionUrl, contractId, eventName, batchingConfig } = trigger;
    const continueOnError = batchingConfig?.continueOnError ?? true;

    const results = {
        total: eventPayloads.length,
        successful: 0,
        failed: 0,
        failures: []
    };

    logger.info('Processing batch action', {
        actionType,
        contractId,
        eventName,
        batchSize: eventPayloads.length,
        continueOnError
    });

    for (let i = 0; i < eventPayloads.length; i++) {
        const eventPayload = eventPayloads[i];

        try {
            switch (actionType) {
                case 'email': {
                    await sendEventNotification({
                        trigger,
                        payload: eventPayload,
                    });
                    break;
                }

                case 'discord': {
                    if (!actionUrl) {
                        throw new Error('Missing actionUrl for Discord trigger');
                    }

                    const discordPayload = {
                        embeds: [{
                            title: `Batch Event: ${eventName}`,
                            description: `Contract: ${contractId} (${i + 1}/${eventPayloads.length})`,
                            fields: [
                                {
                                    name: 'Payload',
                                    value: `\`\`\`json\n${JSON.stringify(eventPayload, null, 2).slice(0, 1000)}\n\`\`\``,
                                },
                            ],
                            color: 0x5865F2,
                            timestamp: new Date().toISOString(),
                        }],
                    };

                    await sendDiscordNotification(actionUrl, discordPayload);
                    break;
                }

                case 'telegram': {
                    const { botToken, chatId } = trigger;
                    if (!botToken || !chatId) {
                        throw new Error('Missing botToken or chatId for Telegram trigger');
                    }

                    const message = `🔔 *Batch Event Triggered* (${i + 1}/${eventPayloads.length})\n\n` +
                        `*Event:* ${telegramService.escapeMarkdownV2(eventName)}\n` +
                        `*Contract:* \`${contractId}\`\n\n` +
                        `*Payload:*\n\`\`\`\n${JSON.stringify(eventPayload, null, 2)}\n\`\`\``;

                    await telegramService.sendTelegramMessage(botToken, chatId, message);
                    break;
                }

                case 'webhook': {
                    if (!actionUrl) {
                        throw new Error('Missing actionUrl for webhook trigger');
                    }

                    const payload = {
                        contractId,
                        eventName,
                        payload: eventPayload,
                        batchIndex: i,
                        batchSize: eventPayloads.length,
                        batchPayloads: eventPayloads, // Send the full batch for webhooks
                    };

                    await webhookService.sendSignedWebhook(
                        actionUrl,
                        payload,
                        trigger.webhookSecret,
                        { organizationId: trigger.organization }
                    );
                    break;
                }

                default:
                    throw new Error(`Unsupported action type: ${actionType}`);
            }

            results.successful++;

        } catch (error) {
            results.failed++;
            results.failures.push({
                index: i,
                error: error.message,
                payload: eventPayload
            });

            logger.error('Batch event failed', {
                actionType,
                contractId,
                eventName,
                batchIndex: i,
                batchSize: eventPayloads.length,
                error: error.message
            });

            if (!continueOnError) {
                // If not continuing on error, fail the entire batch
                throw new Error(`Batch failed at event ${i}: ${error.message}`);
            }
        }
    }

    logger.info('Batch action completed', {
        actionType,
        contractId,
        eventName,
        results
    });

    if (results.failed > 0 && !continueOnError) {
        throw new Error(`Batch failed: ${results.failed}/${results.total} events failed`);
    }

    return results;
}

/**
 * Create and start the BullMQ worker
 */
function createWorker() {
    const worker = new Worker(
        'action-queue',
        async (job) => {
            try {
                const result = await executeAction(job);
                
                logger.info('Action job completed successfully', {
                    jobId: job.id,
                    actionType: job.data.trigger.actionType,
                    result: result,
                });

                return result;
            } catch (error) {
                logger.error('Action job failed', {
                    jobId: job.id,
                    actionType: job.data.trigger.actionType,
                    error: error.message,
                    stack: error.stack,
                    attempt: job.attemptsMade + 1,
                });

                throw error;
            }
        },
        {
            connection,
            concurrency: WORKER_CONCURRENCY,
            limiter: {
                max: 10,
                duration: 1000,
            },
        }
    );

    worker.on('completed', (job) => {
        logger.info('Job completed', {
            jobId: job.id,
            actionType: job.data.trigger.actionType,
        });
    });

    worker.on('failed', (job, err) => {
        logger.error('Job failed', {
            jobId: job?.id,
            actionType: job?.data?.trigger?.actionType,
            error: err.message,
            attemptsRemaining: job ? job.opts.attempts - job.attemptsMade : 0,
        });
    });

    worker.on('error', (err) => {
        logger.error('Worker error', {
            error: err.message,
            stack: err.stack,
        });
    });

    logger.info('BullMQ worker started', {
        concurrency: WORKER_CONCURRENCY,
        redisHost: REDIS_HOST,
        redisPort: REDIS_PORT,
    });

    return worker;
}

module.exports = {
    createWorker,
    connection,
};
