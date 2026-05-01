const { createRedisClient } = require('../config/redis');
const logger = require('../config/logger');

// How long a dedup key lives — long enough to cover any retry window
const DEDUP_TTL_SECONDS = parseInt(process.env.DEDUP_TTL_SECONDS || '300', 10); // 5 min default
// How long a distributed lock is held before auto-expiry
const LOCK_TTL_SECONDS = parseInt(process.env.DEDUP_LOCK_TTL_SECONDS || '30', 10);

let redis;

function getClient() {
    if (!redis) {
        redis = createRedisClient({ lazyConnect: true, maxRetriesPerRequest: null });
    }
    return redis;
}

/**
 * Builds a deterministic dedup key for an event + trigger pair.
 * Uses ledger + txHash + topic so the same on-chain event is never fired twice.
 */
function buildDedupKey(triggerId, event) {
    const id = event.id || `${event.ledger}:${event.txHash || event.transactionHash}`;
    return `dedup:${triggerId}:${id}`;
}

/**
 * Returns true if this event has already been processed for the given trigger.
 * Atomically sets the key with TTL so concurrent workers won't double-fire.
 */
async function isDuplicate(triggerId, event) {
    const key = buildDedupKey(triggerId, event);
    // SET key 1 NX EX ttl — returns "OK" if set, null if already existed
    const result = await getClient().set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    if (result === null) {
        logger.debug('Duplicate event skipped', { triggerId, key });
        return true;
    }
    return false;
}

/**
 * Acquires a distributed lock. Returns a release function, or null if lock not acquired.
 * Prevents multiple workers from processing the same trigger concurrently.
 */
async function acquireLock(lockKey) {
    const token = `${process.pid}-${Date.now()}-${Math.random()}`;
    const key = `lock:${lockKey}`;
    const result = await getClient().set(key, token, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (result !== 'OK') {
        return null;
    }

    return async function release() {
        // Only delete if we still own the lock (Lua script for atomicity)
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        await getClient().eval(script, 1, key, token);
    };
}

module.exports = { isDuplicate, acquireLock, buildDedupKey };
