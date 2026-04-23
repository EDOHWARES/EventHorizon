const test = require('node:test');
const assert = require('node:assert/strict');

const {
    passesFilters,
    evaluateFilter,
} = require('../src/utils/filterEvaluator');

const sampleEvent = {
    id: 'evt_123',
    ledger: 1000,
    contractId: 'C123',
    type: 'contract',
    value: {
        amount: 500,
        currency: 'USDC',
        tags: ['transfer', 'outgoing'],
        from: 'GABC',
        to: 'GXYZ',
    },
    topics: ['transfer', 'GABC', 'GXYZ'],
    nested: {
        level1: {
            level2: {
                level3: {
                    target: 'deep-value',
                    score: 42,
                },
            },
        },
    },
    items: [
        { name: 'alpha', price: 10, active: true },
        { name: 'beta', price: 25, active: false },
        { name: 'gamma', price: 100, active: true },
    ],
};

test('passesFilters returns true when filters are empty', () => {
    assert.equal(passesFilters(sampleEvent, []), true);
    assert.equal(passesFilters(sampleEvent, undefined), true);
    assert.equal(passesFilters(sampleEvent, null), true);
});

test('passesFilters returns false for non-array filters', () => {
    assert.equal(passesFilters(sampleEvent, { bad: 'shape' }), false);
});

test('eq operator matches exact value at nested path', () => {
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.currency', operator: 'eq', value: 'USDC' }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.currency', operator: 'eq', value: 'XLM' }]),
        false,
    );
});

test('eq coerces numeric string comparisons', () => {
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.amount', operator: 'eq', value: '500' }]),
        true,
    );
});

test('neq operator inverts equality', () => {
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.currency', operator: 'neq', value: 'XLM' }]),
        true,
    );
});

test('numeric comparisons work across gt/gte/lt/lte', () => {
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.amount', operator: 'gt', value: 100 }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.amount', operator: 'gte', value: 500 }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.amount', operator: 'lt', value: 1000 }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.amount', operator: 'lte', value: 499 }]),
        false,
    );
});

test('contains operator works on arrays, strings, and objects', () => {
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.tags', operator: 'contains', value: 'transfer' }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.currency', operator: 'contains', value: 'USD' }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value', operator: 'contains', value: 'amount' }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.tags', operator: 'contains', value: 'missing' }]),
        false,
    );
});

test('in operator checks membership', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.value.currency',
            operator: 'in',
            value: ['USDC', 'XLM'],
        }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.value.currency',
            operator: 'in',
            value: ['XLM'],
        }]),
        false,
    );
});

test('exists operator detects presence and absence', () => {
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.amount', operator: 'exists' }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.nonexistent', operator: 'exists' }]),
        false,
    );
    assert.equal(
        passesFilters(sampleEvent, [{ path: '$.value.nonexistent', operator: 'exists', value: false }]),
        true,
    );
});

test('evaluates deeply nested paths', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.nested.level1.level2.level3.target',
            operator: 'eq',
            value: 'deep-value',
        }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.nested.level1.level2.level3.score',
            operator: 'gt',
            value: 40,
        }]),
        true,
    );
});

test('evaluates filters over arrays with JSONPath slice/wildcard', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.items[*].name',
            operator: 'eq',
            value: 'gamma',
        }]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.items[*].price',
            operator: 'gt',
            value: 50,
        }]),
        true,
    );
});

test('evaluates filters over filtered array expressions', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.items[?(@.active==true)].name',
            operator: 'contains',
            value: 'alpha',
        }]),
        true,
    );
});

test('all filters must pass (AND semantics)', () => {
    assert.equal(
        passesFilters(sampleEvent, [
            { path: '$.value.currency', operator: 'eq', value: 'USDC' },
            { path: '$.value.amount', operator: 'gt', value: 100 },
        ]),
        true,
    );
    assert.equal(
        passesFilters(sampleEvent, [
            { path: '$.value.currency', operator: 'eq', value: 'USDC' },
            { path: '$.value.amount', operator: 'gt', value: 10000 },
        ]),
        false,
    );
});

test('missing path causes comparison filter to fail', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.nonexistent.field',
            operator: 'eq',
            value: 'anything',
        }]),
        false,
    );
});

test('invalid filter paths fail closed rather than throwing', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$..*',
            operator: 'exists',
        }]),
        false,
    );
    assert.equal(
        passesFilters(sampleEvent, [{
            path: 'not-a-valid-path',
            operator: 'eq',
            value: 1,
        }]),
        false,
    );
});

test('evaluateFilter returns false for malformed filters', () => {
    assert.equal(evaluateFilter({ path: '$.x', operator: 'weird', value: 1 }, sampleEvent), false);
    assert.equal(evaluateFilter(null, sampleEvent), false);
});

test('non-numeric values fail numeric comparisons gracefully', () => {
    assert.equal(
        passesFilters(sampleEvent, [{
            path: '$.value.currency',
            operator: 'gt',
            value: 10,
        }]),
        false,
    );
});
