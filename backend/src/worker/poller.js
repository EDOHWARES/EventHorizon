const { rpc, xdr } = require('@stellar/stellar-sdk');
const Redis = require('ioredis');
const Redlock = require('redlock');
const Trigger = require('../models/trigger.model');
const batchService = require('../services/batch.service');
const logger = require('../config/logger');
const { passesFilters } = require('../utils/filterEvaluator');
const pollerState = require('./pollerState');

// Redis setup for distributed locks and deduplication
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const redisClient = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    lazyConnect: true,
});

const redlock = new Redlock(
    [redisClient],
    {
        driftFactor: 0.01,
        retryCount:  0, // We handle retries via the interval
        retryDelay:  200,
        retryJitter:  200,
        automaticExtensionThreshold: 500,
    }
);

redisClient.on('error', (err) => {
    logger.warn('Poller Redis error:', { error: err.message });
});

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
    const axios = require('axios');
    const { sendEventNotification } = require('../services/email.service');
    const { sendDiscordNotification } = require('../services/discord.service');
    const slackService = require('../services/slack.service');
    const telegramService = require('../services/telegram.service');

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
                return await axios.post(actionUrl, {
                    contractId,
                    eventName,
                    payload: eventPayload,
                });

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

async function executePollCycle() {
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

        for (const trigger of triggers) {
            logger.debug(`Polling for: ${trigger.eventName} on ${trigger.contractId}`);
            try {
                // Determine our ledger bounds for this trigger
                let startLedger = trigger.lastPolledLedger;
                if (!startLedger || startLedger === 0) {
                    // Start close to the current network tip if it's brand new
                    startLedger = Math.max(1, latestLedgerSequence - 100);
                } else {
                    // If we've already polled up to or past the network tip, skip
                    if (startLedger >= latestLedgerSequence) continue;
                    // Start from the *next* ledger
                    startLedger += 1;
                }

                // Apply max window size
                const endLedger = Math.min(startLedger + MAX_LEDGERS_PER_POLL, latestLedgerSequence);

                // Convert event name to XDR format for topic filtering
                const eventTopicXdr = xdr.ScVal.scvSymbol(trigger.eventName).toXDR("base64");

                let cursor = undefined;
                let foundEvents = 0;
                let failedActions = 0;

                // 2. Fetch events with pagination support
                while (true) {
                    const response = await withRetry(() => server.getEvents({
                        startLedger,
                        filters: [
                            {
                                type: "contract",
                                contractIds: [trigger.contractId],
                                topics: [[eventTopicXdr]]
                            }
                        ],
                        pagination: { limit: 100, cursor }
                    }));

                    // Parse the events
                    if (response && response.events && response.events.length > 0) {
                        for (const event of response.events) {
                            // Ensure the event falls within our intended window
                            if (event.ledger <= endLedger) {
                                if (!passesFilters(event, trigger.filters)) {
                                    logger.debug('Event filtered out by trigger filters', {
                                        triggerId: trigger._id,
                                        eventId: event.id,
                                        eventLedger: event.ledger,
                                    });
                                    continue;
                                }

                                // Idempotency check: Ensure exactly-once processing
                                const dedupKey = `processed_event:${trigger._id}:${event.id}`;
                                const isNew = await redisClient.set(dedupKey, '1', 'NX', 'EX', 604800); // 7 days TTL
                                if (!isNew) {
                                    logger.debug('Skipping already processed event', {
                                        triggerId: trigger._id,
                                        eventId: event.id
                                    });
                                    continue;
                                }

                                foundEvents++;
                                try {
                                    await processEvent(trigger, event);

                                    // Track execution stats (events added to batch)
                                    trigger.totalExecutions = (trigger.totalExecutions || 0) + 1;
                                    trigger.lastSuccessAt = new Date();
                                } catch (error) {
                                    // Track execution stats (immediate failure)
                                    trigger.totalExecutions = (trigger.totalExecutions || 0) + 1;
                                    trigger.failedExecutions = (trigger.failedExecutions || 0) + 1;
                                    failedActions++;
                                    logger.error(`Event processing failed for trigger ${trigger._id}`, {
                                        error: error.message,
                                        actionType: trigger.actionType,
                                        eventLedger: event.ledger,
                                    });
                                }
                            }
                        }

                        // Determine if there are more pages
                        const lastEvent = response.events[response.events.length - 1];
                        if (response.events.length >= 100 && lastEvent && lastEvent.id) {
                            cursor = lastEvent.id;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }

                    // Sleep between pages to avoid tripping rate limits
                    await sleep(INTER_PAGE_DELAY_MS);
                }

                // 3. Update trigger state
                trigger.lastPolledLedger = endLedger;
                await trigger.save();

                if (foundEvents > 0) {
                    logger.info(`Collected events for trigger`, {
                        triggerId: trigger._id,
                        foundEvents,
                        failedActions,
                    });
                }

            } catch (triggerError) {
                logger.error(`Error processing trigger ${trigger._id}:`, { triggerError: triggerError.message });
                // On failure, we skip updating lastPolledLedger so it will retry on the next interval
            }

            // Small delay between triggers to spread RPC load
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

async function pollEvents() {
    const lockKey = 'locks:poller:leader';
    const pollInterval = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);
    // Add a buffer to the TTL to avoid expiration during minor event loop delays
    const lockTTL = pollInterval + 5000;

    try {
        await redlock.using([lockKey], lockTTL, async (signal) => {
            // We successfully acquired the lock; we are the leader
            pollerState.setLeader(true);
            pollerState.setLastPollTime(new Date());

            await executePollCycle();
        });
    } catch (err) {
        // ResourceLockedError or other lock errors mean we are not the leader
        pollerState.setLeader(false);
        logger.debug('Skipping poll cycle, another instance is the leader');
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
