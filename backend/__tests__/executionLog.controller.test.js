/**
 * Unit tests for executionLog.controller.js
 *
 * The executionLog.service is mocked so no real database is required.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Mock the service ──────────────────────────────────────────────────────────

const mockService = {
    getLogsForTrigger: async () => ({
        rows: [{ id: 'uuid-1', status: 'success', executed_at: new Date() }],
        total: 1,
    }),
    getExecutionTrends: async () => [
        { bucket: new Date(), total_executions: '5', successful: '4', failed: '1' },
    ],
    getTriggerHealthStats: async () => ({
        total: 10,
        successful: 9,
        failed: 1,
        successRate: 90,
        avgDurationMs: 180,
    }),
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request.includes('services/executionLog.service')) {
        return mockService;
    }
    return originalLoad.apply(this, arguments);
};

const controller = require('../src/controllers/executionLog.controller');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
    const res = { _status: 200, _body: null };
    res.status = (code) => { res._status = code; return res; };
    res.json = (body) => { res._body = body; return res; };
    return res;
}

function makeReq(overrides = {}) {
    return {
        params: {},
        query: {},
        user: {
            id: 'user-1',
            organization: { _id: 'org-1' },
        },
        ...overrides,
    };
}

// ── getLogsForTrigger ─────────────────────────────────────────────────────────

test('getLogsForTrigger returns paginated logs', async () => {
    const req = makeReq({ params: { triggerId: 'trigger-1' }, query: { limit: '10', offset: '0' } });
    const res = makeRes();

    await controller.getLogsForTrigger(req, res, (err) => { throw err; });

    assert.equal(res._body.success, true);
    assert.ok(Array.isArray(res._body.data.logs));
    assert.equal(res._body.data.pagination.total, 1);
    assert.equal(res._body.data.pagination.limit, 10);
    assert.equal(res._body.data.pagination.offset, 0);
    assert.equal(res._body.data.pagination.hasMore, false);
});

test('getLogsForTrigger caps limit at 500', async () => {
    let capturedOpts;
    const savedFn = mockService.getLogsForTrigger;
    mockService.getLogsForTrigger = async (id, opts) => {
        capturedOpts = opts;
        return { rows: [], total: 0 };
    };

    const req = makeReq({ params: { triggerId: 'trigger-1' }, query: { limit: '9999' } });
    const res = makeRes();

    await controller.getLogsForTrigger(req, res, (err) => { throw err; });

    assert.equal(capturedOpts.limit, 500);
    mockService.getLogsForTrigger = savedFn;
});

test('getLogsForTrigger forwards AppError for invalid from date', async () => {
    const req = makeReq({ params: { triggerId: 'trigger-1' }, query: { from: 'not-a-date' } });
    const res = makeRes();

    let caughtError;
    await controller.getLogsForTrigger(req, res, (err) => { caughtError = err; });

    assert.ok(caughtError);
    assert.equal(caughtError.statusCode, 400);
});

// ── getTrends ─────────────────────────────────────────────────────────────────

test('getTrends returns bucketed data', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();

    await controller.getTrends(req, res, (err) => { throw err; });

    assert.equal(res._body.success, true);
    assert.ok(Array.isArray(res._body.data.buckets));
    assert.ok(res._body.data.interval);
});

test('getTrends defaults to last 24 hours when no dates provided', async () => {
    let capturedOpts;
    const savedFn = mockService.getExecutionTrends;
    mockService.getExecutionTrends = async (orgId, opts) => {
        capturedOpts = opts;
        return [];
    };

    const req = makeReq({ query: {} });
    const res = makeRes();

    await controller.getTrends(req, res, (err) => { throw err; });

    const diffMs = capturedOpts.to - capturedOpts.from;
    // Should be approximately 24 hours (allow 5 s tolerance)
    assert.ok(diffMs >= 24 * 3600 * 1000 - 5000 && diffMs <= 24 * 3600 * 1000 + 5000);

    mockService.getExecutionTrends = savedFn;
});

// ── getTriggerHealth ──────────────────────────────────────────────────────────

test('getTriggerHealth returns health stats', async () => {
    const req = makeReq({ params: { triggerId: 'trigger-1' }, query: { windowHours: '24' } });
    const res = makeRes();

    await controller.getTriggerHealth(req, res, (err) => { throw err; });

    assert.equal(res._body.success, true);
    assert.equal(res._body.data.triggerId, 'trigger-1');
    assert.equal(res._body.data.successRate, 90);
    assert.equal(res._body.data.windowHours, 24);
});

test('getTriggerHealth caps windowHours at 720', async () => {
    let capturedWindow;
    const savedFn = mockService.getTriggerHealthStats;
    mockService.getTriggerHealthStats = async (id, window) => {
        capturedWindow = window;
        return { total: 0, successful: 0, failed: 0, successRate: null, avgDurationMs: null };
    };

    const req = makeReq({ params: { triggerId: 'trigger-1' }, query: { windowHours: '9999' } });
    const res = makeRes();

    await controller.getTriggerHealth(req, res, (err) => { throw err; });

    assert.equal(capturedWindow, 720);
    mockService.getTriggerHealthStats = savedFn;
});
