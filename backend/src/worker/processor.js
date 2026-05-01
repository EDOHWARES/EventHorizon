const { Worker } = require('bullmq');
const Redis = require('ioredis');
const axios = require('axios');
const { performance } = require('perf_hooks');
const { sendEventNotification } = require('../services/email.service');
const { sendDiscordNotification } = require('../services/discord.service');
const telegramService = require('../services/telegram.service');
const logger = require('../config/logger');
const pubsub = require('../graphql/pubsub');
const { transformPayload } = require('./wasmTransformer');
let sendEventNotification;
try {
    sendEventNotification = require('../services/email.service').sendEventNotification;
} catch (e) {
    sendEventNotification = async () => { console.warn('Email service not available'); };
}

let sendDiscordNotification;
try {
    sendDiscordNotification = require('../services/discord.service').sendDiscordNotification;
} catch (e) {
    sendDiscordNotification = async () => { console.warn('Discord service not available'); };
}
const { sendDiscordNotification } = require('../services/discord.service');
const telegramService = require('../services/telegram.service');
const { getAccessToken } = require('../services/oauth2.service');
const webhookService = require('../services/webhook.service');
const logger = require('../config/logger');
const { withSpan, runWithExtractedContext } = require('../utils/tracing');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 5);

const connectionConfig = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: null,
};

// Default connection for general queue usage if needed
const connection = new Redis(connectionConfig);

/**
 * Execute the action based on the trigger type
 */
async function executeAction(job) {
    let { trigger, eventPayload, eventPayloads, isBatch } = job.data;
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

    // Apply Custom WebAssembly Payload Transformation if configured
    if (trigger.transformerConfig && trigger.transformerConfig.wasmBase64) {
        const start = performance.now();
        try {
            if (isBatch) {
                for (let i = 0; i < eventPayloads.length; i++) {
                    eventPayloads[i] = await transformPayload(trigger.transformerConfig.wasmBase64, eventPayloads[i], trigger.transformerConfig.timeoutMs);
                }
            } else {
                eventPayload = await transformPayload(trigger.transformerConfig.wasmBase64, eventPayload, trigger.transformerConfig.timeoutMs);
            }
            const duration = performance.now() - start;
            logger.info('WASM payload transformation successful', {
                jobId: job.id,
                durationMs: duration.toFixed(2),
                isBatch,
                batchSize
            });
        } catch (error) {
            logger.error('WASM payload transformation failed', { jobId: job.id, error: error.message });
            if (!trigger.transformerConfig.continueOnError) {
                throw new Error(`WASM Transformation failed: ${error.message}`);
            }
        }
    }

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
            const { sendEventNotification } = require('../services/email.service');
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

            return await axios.post(actionUrl, {
                contractId,
                eventName,
                payload: eventPayload,
            });
            const headers = {};
            if (trigger.authConfig?.type === 'oauth2') {
                const token = await getAccessToken(trigger);
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            return await axios.post(actionUrl, {
                contractId,
                eventName,
                payload: eventPayload,
            }, { headers });
            const payload = {
                contractId,
                eventName,
                payload: eventPayload,
            };

            return await webhookService.sendSignedWebhook(
                actionUrl,
                payload,
                trigger.webhookSecret,
                {
                    customHeaders: trigger.customHeaders
                },
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

    let webhookHeaders = {};
    if (actionType === 'webhook' && trigger.authConfig?.type === 'oauth2') {
        try {
            const token = await getAccessToken(trigger);
            if (token) {
                webhookHeaders['Authorization'] = `Bearer ${token}`;
            }
        } catch (error) {
            logger.error('Failed to fetch token for batch', { error: error.message });
            if (!continueOnError) throw error;
        }
    // Special handling for optimized webhook batching
    if (actionType === 'webhook') {
        return await executeWebhookBatchAction(trigger, eventPayloads);
    }

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
                    const { sendEventNotification } = require('../services/email.service');
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

                    await axios.post(actionUrl, {
                        contractId,
                        eventName,
                        payload: eventPayload,
                        batchIndex: i,
                        batchSize: eventPayloads.length,
                        batchPayloads: eventPayloads, // Send the full batch for webhooks
                    });
                    }, { headers: webhookHeaders });
                    };

                    await webhookService.sendSignedWebhook(
                        actionUrl,
                        payload,
                        trigger.webhookSecret,
                        {
                            customHeaders: trigger.customHeaders
                        },
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
 * Execute a single-request webhook batch for network throughput optimization
 */
async function executeWebhookBatchAction(trigger, eventPayloads) {
    const { actionUrl, contractId, eventName } = trigger;

    if (!actionUrl) {
        throw new Error('Missing actionUrl for webhook trigger');
    }

    const batchPayload = {
        contractId,
        eventName,
        isBatch: true,
        batchSize: eventPayloads.length,
        events: eventPayloads.map((payload, index) => ({
            payload,
            index,
            timestamp: new Date().toISOString()
        }))
    };

    logger.debug('Sending optimized webhook batch', {
        url: actionUrl,
        batchSize: eventPayloads.length,
        contractId,
        eventName
    });

    try {
        const response = await webhookService.sendSignedWebhook(
            actionUrl,
            batchPayload,
            trigger.webhookSecret
        );

        return {
            total: eventPayloads.length,
            successful: eventPayloads.length,
            failed: 0,
            status: response.status
        };
    } catch (error) {
        logger.error('Optimized webhook batch failed', {
            url: actionUrl,
            batchSize: eventPayloads.length,
            error: error.message
        });

        // For webhooks, we fail the entire batch if the request fails
        return {
            total: eventPayloads.length,
            successful: 0,
            failed: eventPayloads.length,
            error: error.message
        };
    }
}

/**
 * Create and start the BullMQ worker
 */
function createWorker() {
    const worker = new Worker(
        'action-queue',
        async (job) => {
            const traceCarrier = job?.data?._traceContext;
            return runWithExtractedContext(traceCarrier, () => withSpan(
                'worker.action.execute',
                async () => {
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
                    'job.id': String(job.id),
                    'job.attempt': job.attemptsMade + 1,
                    'action.type': job?.data?.trigger?.actionType,
                    'action.contract_id': job?.data?.trigger?.contractId,
                    'action.event_name': job?.data?.trigger?.eventName,
                    'action.is_batch': Boolean(job?.data?.isBatch),
                },
            ));
        },
        {
            connection: new Redis(connectionConfig),
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
            
            if (job) {
                pubsub.publish('EXECUTION_LOG', {
                    executionLog: {
                        jobId: job.id,
                        triggerId: String(job.data.trigger._id),
                        actionType: job.data.trigger.actionType,
                        status: 'FAILED',
                        error: err.message,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        // Fire DLQ threshold alert (non-blocking)
        require('../services/dlq.service').checkAndAlert().catch(() => {});
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
    executeAction,
    executeSingleAction,
    executeBatchAction,
    executeWebhookBatchAction
};
