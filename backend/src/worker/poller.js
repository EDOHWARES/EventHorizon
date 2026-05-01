const { rpc, xdr } = require('@stellar/stellar-sdk');
const Trigger = require('../models/trigger.model');
const batchService = require('../services/batch.service');
const correlationService = require('../services/correlation.service');
const logger = require('../config/logger');
const { passesFilters } = require('../utils/filterEvaluator');

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL, {
    timeout: parseInt(process.env.RPC_TIMEOUT_MS || '10000', 10),
});

// --- Configuration ---
const MAX_LEDGERS_PER_POLL = parseInt(process.env.MAX_LEDGERS_PER_POLL || '10000', 10);
const RPC_MAX_RETRIES = parseInt(process.env.RPC_MAX_RETRIES || '3', 10);
const RPC_BASE_DELAY_MS = parseInt(process.env.RPC_BASE_DELAY_MS || '1000', 10);
const INTER_TRIGGER_DELAY_MS = parseInt(process.env.INTER_TRIGGER_DELAY_MS || '100', 10);
const INTER_PAGE_DELAY_MS = parseInt(process.env.INTER_PAGE_DELAY_MS || '200', 10);

// --- Utility Functions ---

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential backoff.
 * Retries on network errors, 429 (rate limit), and 5xx server errors.
 */
async function withRetry(fn, { maxRetries = RPC_MAX_RETRIES, baseDelay = RPC_BASE_DELAY_MS } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const status = error?.response?.status || error?.status;
            const isRetryable = !status || status === 429 || status >= 500
                || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';

            if (!isRetryable || attempt === maxRetries) {
                throw error;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            logger.warn(`RPC request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
                error: error.message,
                status,
            });
            await sleep(delay);
        }
    }
    throw lastError;
}

// --- Action Execution ---

// Try to load queue, fallback to direct execution if unavailable
let enqueueAction;
let queueAvailable = false;

try {
    const queue = require('./queue');
    enqueueAction = queue.enqueueAction;
    queueAvailable = true;
    logger.info('Queue system available - actions will be processed in background');
} catch (error) {
    logger.warn('Queue system unavailable - actions will be executed directly', {
        error: error.message,
        note: 'Install Redis to enable background job processing'
    });

    // Fallback: direct execution with full action routing
    const { sendEventNotification } = require('../services/email.service');
    const { sendDiscordNotification } = require('../services/discord.service');
    const slackService = require('../services/slack.service');
    const telegramService = require('../services/telegram.service');
    const webhookService = require('../services/webhook.service');

    enqueueAction = async function executeTriggerActionDirect(trigger, eventPayload) {
        const { actionType, actionUrl, contractId, eventName } = trigger;

        logger.info('Executing action directly (no queue)', {
            actionType,
            contractId,
            eventName,
        });

        switch (actionType) {
            case 'email':
                return await sendEventNotification({
                    trigger,
                    payload: eventPayload,
                });

            case 'discord':
                if (!actionUrl) {
                    throw new Error('Missing actionUrl for Discord trigger');
                }
                const discordPayload = {
                    embeds: [{
                        title: `Event: ${eventName}`,
                        description: `Contract: ${contractId}`,
                        fields: [{
                            name: 'Payload',
                            value: `\`\`\`json\n${JSON.stringify(eventPayload, null, 2).slice(0, 1000)}\n\`\`\``,
                        }],
                        color: 0x5865F2,
                        timestamp: new Date().toISOString(),
                    }],
                };
                return await sendDiscordNotification(actionUrl, discordPayload);

            case 'slack':
                return await slackService.execute(trigger, eventPayload);

            case 'telegram': {
                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                const chatId = actionUrl; // actionUrl stores the chat ID for telegram triggers
                if (!botToken || !chatId) {
                    throw new Error('Missing TELEGRAM_BOT_TOKEN or actionUrl (chatId) for telegram trigger');
                }
                const message = [
                    '🔔 *EventHorizon Alert*',
                    '',
                    `*Event:* ${telegramService.escapeMarkdownV2(eventName)}`,
                    `*Contract:* \`${telegramService.escapeMarkdownV2(contractId)}\``,
                    '',
                    `\`\`\`json`,
                    telegramService.escapeMarkdownV2(JSON.stringify(eventPayload, null, 2)),
                    `\`\`\``,
                ].join('\n');
                return await telegramService.sendTelegramMessage(botToken, chatId, message);
            }

            case 'webhook':
                if (!actionUrl) {
                    throw new Error('Missing actionUrl for webhook trigger');
                }
                return await webhookService.sendSignedWebhook(actionUrl, {
                    contractId,
                    eventName,
                    payload: eventPayload,
                }, trigger.webhookSecret, { organizationId: trigger.organization });

            default:
                throw new Error(`Unsupported action type: ${actionType}`);
        }
    };
}

/**
 * Adds an event to the appropriate batch or executes immediately if batching is disabled
 */
async function processEvent(trigger, eventPayload) {
    const { enqueueAction, enqueueBatchAction } = require('./queue');

    // Define the flush callback for batches
    const flushCallback = async (eventPayloads, batchTrigger) => {
        try {
            if (eventPayloads.length === 1) {
                // Single event - use regular enqueue
                await enqueueAction(batchTrigger, eventPayloads[0]);
            } else {
                // Batch - use batch enqueue
                await enqueueBatchAction(batchTrigger, eventPayloads);
            }
        } catch (error) {
            logger.error('Failed to enqueue action(s)', {
                triggerId: batchTrigger._id,
                batchSize: eventPayloads.length,
                error: error.message
            });
        }
    };

    // Add event to batch (or execute immediately if batching disabled)
    batchService.addEvent(trigger, eventPayload, flushCallback);
}

// --- Core Polling Logic ---

async function pollEvents() {
    try {
        const triggers = await Trigger.find({ isActive: true });

        if (triggers.length === 0) {
            logger.debug('No active triggers found for polling');
            return;
        }

        logger.info('Starting event polling cycle', {
            activeTriggers: triggers.length,
            rpcUrl: RPC_URL
        });

        // 1. Get the current network tip to cap our sliding window
        let latestLedgerSequence = 0;
        try {
            const latest = await withRetry(() => server.getLatestLedger());
            latestLedgerSequence = latest.sequence;
        } catch (e) {
            logger.error('Failed to get latest ledger from RPC after retries:', { error: e.message });
            return;
        }

        // Group triggers by contract
        const triggersByContract = {};
        for (const trigger of triggers) {
            if (!triggersByContract[trigger.contractId]) {
                triggersByContract[trigger.contractId] = [];
            }
            triggersByContract[trigger.contractId].push(trigger);
        }

        for (const contractId in triggersByContract) {
            const contractTriggers = triggersByContract[contractId];
            logger.debug(`Polling for contract: ${contractId}, triggers: ${contractTriggers.length}`);

            try {
                // Determine ledger bounds based on the furthest behind trigger
                let startLedger = Math.max(...contractTriggers.map(t => t.lastPolledLedger || 0));
                if (startLedger === 0) {
                    startLedger = Math.max(1, latestLedgerSequence - 100);
                } else {
                    if (startLedger >= latestLedgerSequence) continue;
                    startLedger += 1;
                }

                const endLedger = Math.min(startLedger + MAX_LEDGERS_PER_POLL, latestLedgerSequence);

                let cursor = undefined;
                let foundEvents = 0;
                let failedActions = 0;

                // Poll all events from the contract
                while (true) {
                    const response = await withRetry(() => server.getEvents({
                        startLedger,
                        filters: [
                            {
                                type: "contract",
                                contractIds: [contractId]
                            }
                        ],
                        pagination: { limit: 100, cursor }
                    }));

                    if (response && response.events && response.events.length > 0) {
                        for (const event of response.events) {
                            if (event.ledger > endLedger) break;

                            for (const trigger of contractTriggers) {
                                try {
                                    if (trigger.sequence) {
                                        const result = await correlationService.checkSequence(trigger, event);
                                        if (result.shouldFire) {
                                            await processEvent(trigger, result.eventPayload);
                                            trigger.totalExecutions = (trigger.totalExecutions || 0) + 1;
                                            trigger.lastSuccessAt = new Date();
                                            foundEvents++;
                                        }
                                    } else {
                                        if (event.eventName === trigger.eventName && passesFilters(event, trigger.filters)) {
                                            await processEvent(trigger, event);
                                            trigger.totalExecutions = (trigger.totalExecutions || 0) + 1;
                                            trigger.lastSuccessAt = new Date();
                                            foundEvents++;
                                        }
                                    }
                                } catch (error) {
                                    trigger.totalExecutions = (trigger.totalExecutions || 0) + 1;
                                    trigger.failedExecutions = (trigger.failedExecutions || 0) + 1;
                                    failedActions++;
                                    logger.error(`Event processing failed for trigger ${trigger._id}`, {
                                        error: error.message,
                                        eventLedger: event.ledger,
                                    });
                                }
                            }
                        }

                        const lastEvent = response.events[response.events.length - 1];
                        if (response.events.length >= 100 && lastEvent && lastEvent.id) {
                            cursor = lastEvent.id;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }

                    await sleep(INTER_PAGE_DELAY_MS);
                }

                // Update lastPolledLedger for all triggers in the contract
                for (const trigger of contractTriggers) {
                    trigger.lastPolledLedger = endLedger;
                    await trigger.save();
                }

                if (foundEvents > 0) {
                    logger.info(`Processed events for contract`, {
                        contractId,
                        foundEvents,
                        failedActions,
                    });
                }

            } catch (contractError) {
                logger.error(`Error processing contract ${contractId}:`, { error: contractError.message });
            }

            await sleep(INTER_TRIGGER_DELAY_MS);
        }

        logger.info('Event polling cycle completed', {
            processedTriggers: triggers.length
        });
    } catch (error) {
        logger.error('Error in event poller', {
            error: error.message,
            stack: error.stack,
            rpcUrl: RPC_URL
        });
    }
}

function start() {
    const pollInterval = process.env.POLL_INTERVAL_MS || 10000;

    logger.info('Event poller worker starting', {
        pollInterval: pollInterval,
        rpcUrl: RPC_URL,
        maxLedgersPerPoll: MAX_LEDGERS_PER_POLL,
        rpcMaxRetries: RPC_MAX_RETRIES,
        queueEnabled: queueAvailable,
    });

    setInterval(pollEvents, pollInterval);

    logger.info('Event poller worker started successfully', {
        intervalMs: pollInterval,
        mode: queueAvailable ? 'background-queue' : 'direct-execution',
    });
}

module.exports = {
    start,
    enqueueAction,
};
