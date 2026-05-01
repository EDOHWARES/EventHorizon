const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const sinon = require('sinon');
const processor = require('../src/worker/processor');
const webhookService = require('../src/services/webhook.service');
const logger = require('../src/config/logger');

describe('Webhook Batching Engine', () => {
    let sendSignedWebhookStub;

    before(() => {
        // Stub webhookService.sendSignedWebhook to avoid actual HTTP requests
        sendSignedWebhookStub = sinon.stub(webhookService, 'sendSignedWebhook').resolves({ status: 200 });
        // Suppress logger output during tests
        sinon.stub(logger, 'info');
        sinon.stub(logger, 'error');
        sinon.stub(logger, 'debug');
    });

    after(() => {
        sinon.restore();
    });

    it('should send a single signed webhook for a batch of events', async () => {
        const mockTrigger = {
            _id: 'trigger-123',
            actionType: 'webhook',
            actionUrl: 'https://example.com/webhook',
            webhookSecret: 'secret-key',
            contractId: 'test-contract',
            eventName: 'test-event'
        };

        const mockEventPayloads = [
            { id: 1, val: 'a' },
            { id: 2, val: 'b' },
            { id: 3, val: 'c' }
        ];

        const result = await processor.executeWebhookBatchAction(mockTrigger, mockEventPayloads);

        // Verify result statistics
        assert.strictEqual(result.total, 3);
        assert.strictEqual(result.successful, 3);
        assert.strictEqual(result.failed, 0);

        // Verify sendSignedWebhook was called EXACTLY once
        assert.strictEqual(sendSignedWebhookStub.callCount, 1);

        // Verify the payload format
        const [url, payload, secret] = sendSignedWebhookStub.firstCall.args;
        assert.strictEqual(url, 'https://example.com/webhook');
        assert.strictEqual(secret, 'secret-key');
        assert.strictEqual(payload.isBatch, true);
        assert.strictEqual(payload.batchSize, 3);
        assert.strictEqual(payload.events.length, 3);
        assert.strictEqual(payload.events[0].payload.id, 1);
        assert.strictEqual(payload.events[1].payload.id, 2);
        assert.strictEqual(payload.events[2].payload.id, 3);
        assert.ok(payload.events[0].timestamp);
    });

    it('should handle failure of the batched webhook request', async () => {
        sendSignedWebhookStub.resetHistory();
        sendSignedWebhookStub.rejects(new Error('Network error'));

        const mockTrigger = {
            _id: 'trigger-123',
            actionType: 'webhook',
            actionUrl: 'https://example.com/webhook',
            webhookSecret: 'secret-key',
            contractId: 'test-contract',
            eventName: 'test-event'
        };

        const mockEventPayloads = [{ id: 1 }];

        const result = await processor.executeWebhookBatchAction(mockTrigger, mockEventPayloads);

        assert.strictEqual(result.total, 1);
        assert.strictEqual(result.successful, 0);
        assert.strictEqual(result.failed, 1);
        assert.strictEqual(result.error, 'Network error');
    });
});
