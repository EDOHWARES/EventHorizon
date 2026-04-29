const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { executeSingleAction } = require('../services/actionExecutor.service');
const { executeWorkflow } = require('../services/workflow.service');
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
    const { contractId, eventName } = trigger;
    const actionType = trigger.steps?.length > 0 ? 'workflow' : trigger.actionType;

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
        return await executeBatchAction(trigger, eventPayloads, { runIdPrefix: job.id });
    }

    if (trigger.steps?.length > 0) {
        return await executeWorkflow(trigger, eventPayload, { runId: String(job.id) });
    }

    return await executeSingleAction(trigger, eventPayload);
}

/**
 * Execute a batch action with error handling for individual events
 */
async function executeBatchAction(trigger, eventPayloads, options = {}) {
    const { contractId, eventName, batchingConfig } = trigger;
    const actionType = trigger.steps?.length > 0 ? 'workflow' : trigger.actionType;
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
            if (trigger.steps?.length > 0) {
                await executeWorkflow(trigger, eventPayload, {
                    runId: options.runIdPrefix ? `${options.runIdPrefix}:${i}` : undefined,
                    executeStep: options.executeStep,
                });
            } else {
                const webhookPayload = actionType === 'webhook' ? {
                    contractId,
                    eventName,
                    payload: eventPayload,
                    batchIndex: i,
                    batchSize: eventPayloads.length,
                    batchPayloads: eventPayloads,
                } : undefined;

                await executeSingleAction(trigger, eventPayload, { webhookPayload });
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
    executeAction,
    executeBatchAction,
};
