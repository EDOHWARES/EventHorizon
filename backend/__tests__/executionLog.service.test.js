/**
 * Unit tests for executionLog.service.js
 *
 * All TimescaleDB interactions are mocked so no real database is required.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Mock the pg pool ──────────────────────────────────────────────────────────

const queryLog = [];
let queryError = null; // set to an Error to simulate DB failures

const mockPool = {
    query: async (sql, params) => {
        if (queryError) throw queryError;
        queryLog.push({ sql, params });
        // Return sensible defaults for SELECT queries
        if (/SELECT COUNT/i.test(sql)) {
            return { rows: [{ total: '3' }] };
        }
        if (/SELECT/i.test(sql)) {
            return {
                rows: [
                    {
                        id: 'uuid-1',
                        executed_at: new Date('2024-01-01T12:00:00Z'),
                        status: 'success',
                        duration_ms: 120,
                        attempt_number: 1,
                        error_message: null,
                        is_batch: false,
                        batch_size: null,
                        batch_successful: null,
                        batch_failed: null,
                        ledger_sequence: 1000,
                        action_type: 'webhook',
                        source: 'queue',
                    },
                ],
            };
        }
        return { rows: [] };
    },
};

// Patch the timescale config module before requiring the service
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request.includes('config/timescale')) {
        return { getPool: () => mockPool };
    }
    return originalLoad.apply(this, arguments);
};

const svc = require('../src/services/executionLog.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearLog() {
    queryLog.length = 0;
    queryError = null;
}

const fakeTrigger = {
    _id: '507f1f77bcf86cd799439011',
    organization: '507f1f77bcf86cd799439012',
    network: 'testnet',
    contractId: 'CABC123',
    eventName: 'Transfer',
    actionType: 'webhook',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('logExecution inserts a row with correct parameters', async () => {
    clearLog();

    await svc.logExecution({
        triggerId: 'trigger-1',
        organizationId: 'org-1',
        network: 'testnet',
        contractId: 'CABC',
        eventName: 'Transfer',
        actionType: 'webhook',
        status: 'success',
        durationMs: 200,
        attemptNumber: 1,
        source: 'queue',
    });

    assert.equal(queryLog.length, 1);
    const { sql, params } = queryLog[0];
    assert.ok(sql.includes('INSERT INTO execution_logs'));
    assert.equal(params[1], 'trigger-1');   // trigger_id
    assert.equal(params[2], 'org-1');       // organization_id
    assert.equal(params[7], 'success');     // status
    assert.equal(params[8], 200);           // duration_ms
});

test('logExecution does not throw when DB query fails', async () => {
    clearLog();
    queryError = new Error('connection refused');

    // Should resolve without throwing
    await assert.doesNotReject(() =>
        svc.logExecution({
            triggerId: 'trigger-1',
            organizationId: 'org-1',
            network: 'testnet',
            contractId: 'CABC',
            eventName: 'Transfer',
            actionType: 'webhook',
            status: 'failure',
        })
    );
});

test('logSuccess calls logExecution with status=success', async () => {
    clearLog();

    await svc.logSuccess(fakeTrigger, { durationMs: 150, source: 'queue' });

    assert.equal(queryLog.length, 1);
    const { params } = queryLog[0];
    assert.equal(params[7], 'success');
    assert.equal(params[8], 150);
});

test('logFailure calls logExecution with status=failure and error message', async () => {
    clearLog();

    const err = new Error('timeout');
    await svc.logFailure(fakeTrigger, err, { durationMs: 5000, source: 'direct' });

    assert.equal(queryLog.length, 1);
    const { params } = queryLog[0];
    assert.equal(params[7], 'failure');
    assert.equal(params[10], 'timeout');    // error_message
});

test('logBatchExecution marks status=success when no failures', async () => {
    clearLog();

    await svc.logBatchExecution(fakeTrigger, { total: 5, successful: 5, failed: 0 }, { durationMs: 300 });

    assert.equal(queryLog.length, 1);
    const { params } = queryLog[0];
    assert.equal(params[7], 'success');
    assert.equal(params[12], true);         // is_batch
    assert.equal(params[13], 5);            // batch_size
    assert.equal(params[14], 5);            // batch_successful
    assert.equal(params[15], 0);            // batch_failed
});

test('logBatchExecution marks status=failure when all events fail', async () => {
    clearLog();

    await svc.logBatchExecution(fakeTrigger, { total: 3, successful: 0, failed: 3 });

    const { params } = queryLog[0];
    assert.equal(params[7], 'failure');
});

test('getLogsForTrigger returns rows and total', async () => {
    clearLog();

    const result = await svc.getLogsForTrigger('trigger-1', { limit: 10, offset: 0 });

    assert.ok(Array.isArray(result.rows));
    assert.equal(result.total, 3);
    // Two queries: data + count
    assert.equal(queryLog.length, 2);
});

test('getLogsForTrigger applies status filter', async () => {
    clearLog();

    await svc.getLogsForTrigger('trigger-1', { status: 'failure' });

    const dataSql = queryLog[0].sql;
    assert.ok(dataSql.includes('status ='));
});

test('getLogsForTrigger applies date range filters', async () => {
    clearLog();

    const from = new Date('2024-01-01');
    const to = new Date('2024-01-31');
    await svc.getLogsForTrigger('trigger-1', { from, to });

    const dataSql = queryLog[0].sql;
    assert.ok(dataSql.includes('executed_at >='));
    assert.ok(dataSql.includes('executed_at <='));
});

test('getExecutionTrends returns rows', async () => {
    clearLog();

    const rows = await svc.getExecutionTrends('org-1', {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
    });

    assert.ok(Array.isArray(rows));
    assert.equal(queryLog.length, 1);
    assert.ok(queryLog[0].sql.includes('time_bucket'));
});

test('getExecutionTrends rejects invalid bucket interval and falls back to 1 hour', async () => {
    clearLog();

    // Passing an invalid interval should not throw and should use the safe default
    await assert.doesNotReject(() =>
        svc.getExecutionTrends('org-1', { bucketInterval: 'DROP TABLE execution_logs; --' })
    );

    const { params } = queryLog[0];
    // The safe interval should be the last param
    assert.equal(params[params.length - 1], '1 hour');
});

test('getTriggerHealthStats returns computed success rate', async () => {
    // Override mock to return specific counts
    const savedQuery = mockPool.query;
    mockPool.query = async () => ({
        rows: [{
            total: '10',
            successful: '8',
            failed: '2',
            avg_duration_ms: '250',
        }],
    });

    const stats = await svc.getTriggerHealthStats('trigger-1', 24);

    assert.equal(stats.total, 10);
    assert.equal(stats.successful, 8);
    assert.equal(stats.failed, 2);
    assert.equal(stats.successRate, 80);
    assert.equal(stats.avgDurationMs, 250);

    mockPool.query = savedQuery;
});

test('getTriggerHealthStats returns null successRate when no executions', async () => {
    const savedQuery = mockPool.query;
    mockPool.query = async () => ({
        rows: [{ total: '0', successful: '0', failed: '0', avg_duration_ms: null }],
    });

    const stats = await svc.getTriggerHealthStats('trigger-1', 24);

    assert.equal(stats.successRate, null);

    mockPool.query = savedQuery;
});
