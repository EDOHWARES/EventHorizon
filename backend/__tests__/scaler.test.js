const test = require('node:test');
const assert = require('node:assert/strict');

// Mock ioredis before requiring any application files
require('ioredis');
require.cache[require.resolve('ioredis')].exports = class MockRedis {
    constructor() {}
    on() {}
    disconnect() {}
};

const processor = require('../src/worker/processor');
const queue = require('../src/worker/queue');
const scaler = require('../src/worker/scaler');

// Save original methods
const originalCreateWorker = processor.createWorker;
const originalGetQueueStats = queue.getQueueStats;

test.afterEach(() => {
    processor.createWorker = originalCreateWorker;
    queue.getQueueStats = originalGetQueueStats;
    // Clear active workers array manually
    scaler.activeWorkers.length = 0;
});

test('evaluateScaling should scale up workers when total waiting jobs exceed threshold', async () => {
    let workerCreatedCount = 0;
    
    // Mock the createWorker function
    processor.createWorker = () => {
        workerCreatedCount++;
        return { close: async () => {} };
    };

    // Set up 110 waiting jobs (threshold is 50, so desired workers = Math.ceil(110/50) = 3)
    queue.getQueueStats = async () => ({
        testnet: { waiting: 60 },
        public: { waiting: 50 },
    });

    await scaler.evaluateScaling();

    assert.equal(workerCreatedCount, 3);
    assert.equal(scaler.getActiveWorkersCount(), 3);
});

test('evaluateScaling should scale down workers when waiting jobs decrease', async () => {
    let closedCount = 0;
    const mockWorker = {
        close: async () => { closedCount++; }
    };

    // Setup initial 3 workers
    scaler.activeWorkers.push(mockWorker, mockWorker, mockWorker);

    // Set up 20 waiting jobs (threshold is 50, so desired workers = Math.ceil(20/50) = 1)
    queue.getQueueStats = async () => ({
        testnet: { waiting: 20 },
    });

    await scaler.evaluateScaling();

    assert.equal(closedCount, 2);
    assert.equal(scaler.getActiveWorkersCount(), 1);
});

test('evaluateScaling should not exceed max workers', async () => {
    let workerCreatedCount = 0;
    processor.createWorker = () => {
        workerCreatedCount++;
        return { close: async () => {} };
    };

    // Set up 500 waiting jobs (threshold is 50, Math.ceil(500/50) = 10, max = 5)
    queue.getQueueStats = async () => ({
        testnet: { waiting: 500 },
    });

    await scaler.evaluateScaling();

    assert.equal(workerCreatedCount, 5);
    assert.equal(scaler.getActiveWorkersCount(), 5);
});

test('getScalingMetrics returns correct data', async () => {
    queue.getQueueStats = async () => ({
        testnet: { waiting: 15, active: 2 },
        public: { waiting: 5, active: 1 },
    });

    scaler.activeWorkers.push({}, {});

    const metrics = await scaler.getScalingMetrics();

    assert.deepEqual(metrics, {
        totalWaiting: 20,
        totalActive: 3,
        currentWorkers: 2,
        maxWorkers: 5,
        jobsPerWorkerThreshold: 50,
    });
});
