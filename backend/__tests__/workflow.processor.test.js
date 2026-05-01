const test = require('node:test');
const assert = require('node:assert/strict');
const processor = require('../src/worker/processor');

test('batch workflow dispatch executes one workflow per event payload', async () => {
    const trigger = {
        _id: 'trigger-1',
        organization: 'org-1',
        contractId: 'contract-1',
        eventName: 'Transfer',
        batchingConfig: { continueOnError: true },
        steps: [
            { id: 'notify', actionType: 'webhook', actionUrl: 'https://example.com/hook' },
        ],
    };

    const calls = [];
    const result = await processor.executeBatchAction(trigger, [
        { sequence: 1 },
        { sequence: 2 },
    ], {
        runIdPrefix: 'job-123',
        executeStep: async (stepTrigger, eventPayload, options) => {
            calls.push({ stepTrigger, eventPayload, options });
            return { sequence: eventPayload.sequence };
        },
    });

    assert.equal(result.total, 2);
    assert.equal(result.successful, 2);
    assert.equal(result.failed, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.context.runId, 'job-123:0');
    assert.equal(calls[1].options.context.runId, 'job-123:1');
});
