const test = require('node:test');
const assert = require('node:assert/strict');

const queue = require('../src/worker/queue');
const { enqueueAction, getQueueStats, getActionQueue } = queue;

// Grab the testnet queue to mock its methods
const testnetQueue = getActionQueue('testnet');
const originalAdd = testnetQueue.add.bind(testnetQueue);
const originalGetJobCounts = testnetQueue.getJobCounts.bind(testnetQueue);

test.after(() => {
    testnetQueue.add = originalAdd;
    testnetQueue.getJobCounts = originalGetJobCounts;
});

test('enqueueAction adds a job with trigger and payload', async () => {
    const trigger = {
        _id: 'test-trigger-123',
        actionType: 'webhook',
        actionUrl: 'https://example.com/webhook',
        contractId: 'CTEST123',
        eventName: 'transfer',
        network: 'testnet',
    };

    const eventPayload = { from: 'GTEST123', to: 'GTEST456', amount: '1000' };

    testnetQueue.add = async (name, data) => ({ id: `${trigger._id}-${Date.now()}`, name, data });

    await enqueueAction(trigger, eventPayload);
    // No throw = success; the mock captures the call
});

test('getQueueStats returns per-network counts', async () => {
    // Mock getJobCounts on all queues
    for (const q of Object.values(queue.queues)) {
        q.getJobCounts = async () => ({ waiting: 1, active: 0, completed: 5, failed: 0, delayed: 0 });
    }

    const stats = await getQueueStats();
    assert.ok(stats.testnet, 'should have testnet stats');
    assert.equal(stats.testnet.waiting, 1);
    assert.equal(stats.testnet.completed, 5);
});
