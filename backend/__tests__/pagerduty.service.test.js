const test = require('node:test');
const assert = require('node:assert');
const pagerdutyService = require('../src/services/pagerduty.service');

// We use test with a clean environment or mock axios.
test('PagerDutyService', async (t) => {
    // Save original axios
    const axios = require('axios');
    const originalPost = axios.post;

    t.afterEach(() => {
        axios.post = originalPost;
    });

    await t.test('isEnabled() returns false if no integration key', () => {
        pagerdutyService.integrationKey = undefined;
        assert.strictEqual(pagerdutyService.isEnabled(), false);
    });

    await t.test('isEnabled() returns true if integration key exists', () => {
        pagerdutyService.integrationKey = 'test-key';
        assert.strictEqual(pagerdutyService.isEnabled(), true);
    });

    await t.test('triggerIncident() skips if disabled', async () => {
        pagerdutyService.integrationKey = undefined;
        let called = false;
        axios.post = async () => { called = true; };
        
        const result = await pagerdutyService.triggerIncident('test', 'source');
        assert.strictEqual(result, null);
        assert.strictEqual(called, false);
    });

    await t.test('triggerIncident() sends payload if enabled', async () => {
        pagerdutyService.integrationKey = 'test-key';
        let sentPayload = null;
        axios.post = async (url, payload) => {
            sentPayload = payload;
            return { data: { dedup_key: 'dedup-123' } };
        };
        
        const result = await pagerdutyService.triggerIncident('my-title', 'my-source', { info: 'detail' }, 'my-dedup');
        
        assert.strictEqual(result.dedup_key, 'dedup-123');
        assert.strictEqual(sentPayload.routing_key, 'test-key');
        assert.strictEqual(sentPayload.event_action, 'trigger');
        assert.strictEqual(sentPayload.dedup_key, 'my-dedup');
        assert.strictEqual(sentPayload.payload.summary, 'my-title');
        assert.strictEqual(sentPayload.payload.source, 'my-source');
    });

    await t.test('resolveIncident() skips if disabled or no dedup key', async () => {
        pagerdutyService.integrationKey = 'test-key';
        let called = false;
        axios.post = async () => { called = true; };
        
        // no dedup key
        const result1 = await pagerdutyService.resolveIncident(null);
        assert.strictEqual(result1, null);
        assert.strictEqual(called, false);

        // disabled
        pagerdutyService.integrationKey = undefined;
        const result2 = await pagerdutyService.resolveIncident('dedup');
        assert.strictEqual(result2, null);
        assert.strictEqual(called, false);
    });

    await t.test('resolveIncident() sends resolve payload', async () => {
        pagerdutyService.integrationKey = 'test-key';
        let sentPayload = null;
        axios.post = async (url, payload) => {
            sentPayload = payload;
            return { data: { status: 'success' } };
        };
        
        const result = await pagerdutyService.resolveIncident('dedup-123');
        
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(sentPayload.routing_key, 'test-key');
        assert.strictEqual(sentPayload.event_action, 'resolve');
        assert.strictEqual(sentPayload.dedup_key, 'dedup-123');
    });
});
