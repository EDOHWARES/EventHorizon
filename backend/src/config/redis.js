const Redis = require('ioredis');
const logger = require('./logger');

// Cluster nodes can be provided as a comma-separated list: "host1:port1,host2:port2"
const REDIS_CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES || '';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

function parseClusterNodes(raw) {
    return raw.split(',').map((node) => {
        const [host, port] = node.trim().split(':');
        return { host, port: parseInt(port || '6379', 10) };
    });
}

/**
 * Creates a Redis connection — cluster if REDIS_CLUSTER_NODES is set, otherwise standalone.
 * @param {object} [overrides] - ioredis options to merge in
 */
function createRedisClient(overrides = {}) {
    if (REDIS_CLUSTER_NODES) {
        const nodes = parseClusterNodes(REDIS_CLUSTER_NODES);
        logger.info('Connecting to Redis Cluster', { nodes });
        return new Redis.Cluster(nodes, {
            redisOptions: {
                password: REDIS_PASSWORD,
                ...overrides,
            },
            enableReadyCheck: true,
            scaleReads: 'slave',
        });
    }

    return new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        ...overrides,
    });
}

module.exports = { createRedisClient };
