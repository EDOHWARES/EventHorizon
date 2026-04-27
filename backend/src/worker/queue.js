const { Queue } = require('bullmq');
const Redis = require('ioredis');
const networks = require('../config/networks');

const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

const queues = {};

// Initialize a queue partition per network
for (const network of Object.keys(networks)) {
    queues[network] = new Queue(`actionQueue-${network}`, { connection });
}

const getActionQueue = (network = 'testnet') => {
    if (!queues[network]) {
        throw new Error(`Queue for network ${network} not found`);
    }
    return queues[network];
};

const enqueueAction = async (trigger, eventPayload) => {
    const network = trigger.network || 'testnet';
    const queue = getActionQueue(network);
    
    await queue.add(
        `${trigger.actionType}-${trigger._id}`, 
        { trigger, eventPayload },
        {
            attempts: trigger.retryConfig?.maxRetries || 3,
            backoff: { type: 'exponential', delay: trigger.retryConfig?.retryIntervalMs || 2000 }
        }
    );
};

const getQueueStats = async () => {
    const stats = {};
    for (const [network, queue] of Object.entries(queues)) {
        stats[network] = await queue.getJobCounts();
    }
    return stats;
};

const cleanQueue = async () => {
    for (const queue of Object.values(queues)) {
        await queue.clean(24 * 3600 * 1000, 1000, 'completed');
        await queue.clean(7 * 24 * 3600 * 1000, 1000, 'failed');
    }
};

module.exports = { getActionQueue, enqueueAction, getQueueStats, cleanQueue, queues };