const test = require('node:test');
const assert = require('node:assert/strict');

// --- Minimal stubs ---
const makeJob = (id, overrides = {}) => ({
    id,
    name: `webhook-${id}`,
    data: { trigger: {}, eventPayload: {} },
    failedReason: 'Connection refused',
    stacktrace: ['Error: Connection refused\n    at ...'],
    attemptsMade: 3,
    timestamp: Date.now(),
    finishedOn: Date.now(),
    retry: async () => {},
    ...overrides,
});

const failedJobs = [makeJob('job-1'), makeJob('job-2')];

const mockQueue = {
    getFailed: async () => failedJobs,
    getJob: async (id) => failedJobs.find(j => j.id === id) || null,
    getJobCounts: async () => ({ failed: failedJobs.length }),
    clean: async () => failedJobs.map(j => j.id),
};

// Patch the queues object before requiring the service
const queueModule = require('../src/worker/queue');
queueModule.queues.testnet = mockQueue;

// Suppress logger noise
const logger = require('../src/config/logger');
logger.info = () => {};
logger.error = () => {};

const dlq = require('../src/services/dlq.service');

test('listFailed returns serialized failed jobs for a network', async () => {
    const jobs = await dlq.listFailed('testnet');
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].id, 'job-1');
    assert.equal(jobs[0].network, 'testnet');
    assert.ok(jobs[0].failedReason);
    assert.ok(Array.isArray(jobs[0].stacktrace));
});

test('listFailed returns jobs across all networks when network is null', async () => {
    const jobs = await dlq.listFailed(null);
    assert.ok(jobs.length >= 2);
});

test('replayJob retries a known job', async () => {
    let retried = false;
    failedJobs[0].retry = async () => { retried = true; };
    const result = await dlq.replayJob('job-1', 'testnet');
    assert.equal(result.jobId, 'job-1');
    assert.equal(result.network, 'testnet');
    assert.ok(retried);
});

test('replayJob throws 404 for unknown job', async () => {
    await assert.rejects(
        () => dlq.replayJob('nonexistent', 'testnet'),
        (err) => {
            assert.equal(err.statusCode, 404);
            return true;
        }
    );
});

test('clearFailed returns count of removed jobs', async () => {
    const removed = await dlq.clearFailed('testnet');
    assert.equal(removed, failedJobs.length);
});

test('getStats returns total and per-network counts', async () => {
    const stats = await dlq.getStats();
    assert.ok(typeof stats.total === 'number');
    assert.ok(typeof stats.perNetwork === 'object');
    assert.ok('testnet' in stats.perNetwork);
});

test('checkThresholdAndAlert does not throw when no webhooks configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    process.env.DLQ_THRESHOLD = '1'; // ensure threshold is crossed
    await assert.doesNotReject(() => dlq.checkThresholdAndAlert());
});
