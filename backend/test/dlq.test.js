const test = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal mongoose stub ──────────────────────────────────────────────────
const savedDocs = [];
let idCounter = 1;

function makeDoc(data) {
    const doc = {
        ...data,
        _id: String(idCounter++),
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function () { return this; },
        toObject: function () { return { ...this }; },
    };
    savedDocs.push(doc);
    return doc;
}

// Stub FailedAction model
const FailedAction = {
    _docs: savedDocs,
    create: async (data) => makeDoc(data),
    find: (filter = {}) => {
        const filtered = () => savedDocs.filter(d => {
            if (filter.status && d.status !== filter.status) return false;
            if (filter.triggerId && d.triggerId !== filter.triggerId) return false;
            return true;
        });
        const chain = {
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            lean: async () => filtered(),
        };
        // also support .lean() directly (used by redriveAll)
        chain.lean = async () => filtered();
        return chain;
    },
    countDocuments: async (filter = {}) => {
        return savedDocs.filter(d => {
            if (filter.status && d.status !== filter.status) return false;
            return true;
        }).length;
    },
    findById: async (id) => savedDocs.find(d => d._id === id) || null,
    findByIdAndUpdate: async (id, update) => {
        const doc = savedDocs.find(d => d._id === id);
        if (doc) Object.assign(doc, update.$set || update);
        return doc;
    },
    aggregate: async (pipeline) => {
        const groups = {};
        for (const doc of savedDocs) {
            groups[doc.status] = (groups[doc.status] || 0) + 1;
        }
        return Object.entries(groups).map(([_id, count]) => ({ _id, count }));
    },
    updateMany: async (filter, update) => {
        let matched = 0;
        for (const doc of savedDocs) {
            if (filter.status && doc.status !== filter.status) continue;
            if (filter.triggerId && doc.triggerId !== filter.triggerId) continue;
            Object.assign(doc, update.$set || update);
            matched++;
        }
        return { matchedCount: matched };
    },
};

// Stub queue
const enqueuedJobs = [];
const queueStub = {
    enqueueAction: async (trigger, payload) => {
        enqueuedJobs.push({ trigger, payload });
    },
};

// Patch require for isolated unit tests
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === '../models/failedAction.model' || request.endsWith('failedAction.model')) {
        return FailedAction;
    }
    if (request === '../worker/queue' || request.endsWith('worker/queue')) {
        return queueStub;
    }
    return originalLoad.apply(this, arguments);
};

const dlqService = require('../src/services/dlq.service');

// ── Tests ──────────────────────────────────────────────────────────────────

test('recordFailure creates a pending DLQ entry', async () => {
    const entry = await dlqService.recordFailure({
        triggerId: 'trigger-1',
        triggerSnapshot: { actionType: 'webhook' },
        eventPayload: { ledger: 100 },
        errorMessage: 'Connection refused',
        attemptsMade: 3,
    });

    assert.equal(entry.status, 'pending');
    assert.equal(entry.triggerId, 'trigger-1');
    assert.equal(entry.errorMessage, 'Connection refused');
    assert.equal(entry.attemptsMade, 3);
});

test('listFailures returns paginated results', async () => {
    const result = await dlqService.listFailures({ status: 'pending', page: 1, limit: 10 });
    assert.ok(Array.isArray(result.items));
    assert.ok(typeof result.total === 'number');
    assert.equal(result.page, 1);
    assert.equal(result.limit, 10);
});

test('redriveOne re-enqueues a pending entry and marks it resolved', async () => {
    const entry = await dlqService.recordFailure({
        triggerId: 'trigger-2',
        triggerSnapshot: { actionType: 'webhook' },
        eventPayload: { ledger: 200 },
        errorMessage: 'Timeout',
    });

    const before = enqueuedJobs.length;
    const result = await dlqService.redriveOne(entry._id);

    assert.equal(result.status, 'resolved');
    assert.ok(result.resolvedAt instanceof Date);
    assert.equal(enqueuedJobs.length, before + 1);
});

test('redriveOne throws 404 for unknown id', async () => {
    await assert.rejects(
        () => dlqService.redriveOne('nonexistent-id'),
        (err) => {
            assert.equal(err.statusCode, 404);
            return true;
        }
    );
});

test('redriveAll re-drives all pending entries', async () => {
    // Add two more pending entries
    await dlqService.recordFailure({
        triggerId: 'trigger-3',
        triggerSnapshot: {},
        eventPayload: {},
        errorMessage: 'err',
    });
    await dlqService.recordFailure({
        triggerId: 'trigger-3',
        triggerSnapshot: {},
        eventPayload: {},
        errorMessage: 'err2',
    });

    const result = await dlqService.redriveAll({ triggerId: 'trigger-3' });
    assert.ok(result.total >= 2);
    assert.equal(result.failed, 0);
    assert.ok(result.succeeded >= 2);
});

test('purge marks matching entries as purged', async () => {
    await dlqService.recordFailure({
        triggerId: 'trigger-purge',
        triggerSnapshot: {},
        eventPayload: {},
        errorMessage: 'to be purged',
    });

    const result = await dlqService.purge({ status: 'pending', triggerId: 'trigger-purge' });
    assert.ok(result.purged >= 1);
});

test('getStats returns counts per status', async () => {
    const stats = await dlqService.getStats();
    assert.ok(typeof stats.pending === 'number');
    assert.ok(typeof stats.resolved === 'number');
    assert.ok(typeof stats.purged === 'number');
    assert.ok(typeof stats.total === 'number');
});

// Restore
test.after(() => {
    Module._load = originalLoad;
});
