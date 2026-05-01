const test = require('node:test');
const assert = require('node:assert/strict');

// We mock the redis client so no real Redis is needed
const mockStore = new Map();
const mockRedis = {
    set: async (key, value, ...args) => {
        // Parse SET key value [EX seconds] [NX]
        const hasNX = args.includes('NX');
        if (hasNX && mockStore.has(key)) return null;
        mockStore.set(key, value);
        return 'OK';
    },
    eval: async (_script, _numKeys, key, token) => {
        if (mockStore.get(key) === token) {
            mockStore.delete(key);
            return 1;
        }
        return 0;
    },
};

// Patch createRedisClient before requiring the service
const redisConfig = require('../src/config/redis');
const originalCreate = redisConfig.createRedisClient;
redisConfig.createRedisClient = () => mockRedis;

const { isDuplicate, acquireLock, buildDedupKey } = require('../src/services/deduplication.service');

test.after(() => {
    redisConfig.createRedisClient = originalCreate;
    mockStore.clear();
});

test('buildDedupKey produces a stable key from trigger + event', () => {
    const key = buildDedupKey('trigger-1', { id: 'evt-abc' });
    assert.equal(key, 'dedup:trigger-1:evt-abc');
});

test('isDuplicate returns false on first call and true on second', async () => {
    mockStore.clear();
    const event = { id: 'evt-001', ledger: 100 };

    const first = await isDuplicate('trigger-x', event);
    assert.equal(first, false, 'first call should not be a duplicate');

    const second = await isDuplicate('trigger-x', event);
    assert.equal(second, true, 'second call should be a duplicate');
});

test('isDuplicate treats different triggers as independent', async () => {
    mockStore.clear();
    const event = { id: 'evt-002' };

    await isDuplicate('trigger-a', event);
    const result = await isDuplicate('trigger-b', event);
    assert.equal(result, false, 'same event on a different trigger should not be a duplicate');
});

test('acquireLock returns a release function on success', async () => {
    mockStore.clear();
    const release = await acquireLock('poll:trigger-1');
    assert.ok(typeof release === 'function', 'should return a release function');
    await release(); // should not throw
});

test('acquireLock returns null when lock is already held', async () => {
    mockStore.clear();
    await acquireLock('poll:trigger-2');
    const second = await acquireLock('poll:trigger-2');
    assert.equal(second, null, 'second acquire should fail');
});

test('acquireLock release frees the lock for re-acquisition', async () => {
    mockStore.clear();
    const release = await acquireLock('poll:trigger-3');
    await release();
    const second = await acquireLock('poll:trigger-3');
    assert.ok(typeof second === 'function', 'should be acquirable after release');
});
