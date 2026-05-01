const test = require('node:test');
const assert = require('node:assert/strict');

// Aggressive thresholds so the breaker trips fast under test.
process.env.CB_TIMEOUT_MS = '200';
process.env.CB_FAILURE_THRESHOLD = '50';
process.env.CB_RESET_TIMEOUT_MS = '300';
process.env.CB_VOLUME_THRESHOLD = '2';
process.env.CB_ROLLING_WINDOW_MS = '5000';

// Force a fresh module instance so env vars above are picked up.
delete require.cache[require.resolve('../src/services/circuitBreaker')];
const breakers = require('../src/services/circuitBreaker');
const { CircuitBreakerOpenError } = breakers;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each test uses a unique key so breakers don't bleed state into each other.
let keyCounter = 0;
const nextKey = (label) => `${label}-${++keyCounter}-${Date.now()}`;

test('successful call returns the action result', async () => {
    const key = nextKey('success');
    const result = await breakers.fire(key, async (n) => n * 2, [21]);
    assert.equal(result, 42);

    const status = breakers.getStatus()[key];
    assert.equal(status.state, 'CLOSED');
    assert.equal(status.stats.successes, 1);
});

test('repeated failures trip the breaker to OPEN and subsequent calls fast-fail', async () => {
    const key = nextKey('fail');
    const failing = async () => { throw new Error('downstream boom'); };

    // Drive enough failures to exceed the 50% threshold over the volume window.
    for (let i = 0; i < 5; i++) {
        await assert.rejects(breakers.fire(key, failing));
    }

    const status = breakers.getStatus()[key];
    assert.equal(status.state, 'OPEN', 'expected breaker to be OPEN after sustained failures');

    // Next call should fast-fail with the typed error rather than invoking the action.
    let invoked = false;
    const probe = async () => { invoked = true; };
    await assert.rejects(
        breakers.fire(key, probe),
        (err) => err instanceof CircuitBreakerOpenError && err.code === 'CIRCUIT_OPEN'
    );
    assert.equal(invoked, false, 'action must not run while breaker is OPEN');
});

test('breaker transitions through HALF_OPEN and recloses on a successful probe', async () => {
    const key = nextKey('recover');
    const failing = async () => { throw new Error('boom'); };

    for (let i = 0; i < 5; i++) {
        await assert.rejects(breakers.fire(key, failing));
    }
    assert.equal(breakers.getStatus()[key].state, 'OPEN');

    // Wait for resetTimeout so the breaker enters HALF_OPEN on the next call.
    await sleep(400);

    // A successful probe call should close the breaker.
    const result = await breakers.fire(key, async () => 'recovered');
    assert.equal(result, 'recovered');
    assert.equal(breakers.getStatus()[key].state, 'CLOSED');
});

test('timeouts count as failures', async () => {
    const key = nextKey('timeout');
    const slow = () => new Promise((resolve) => setTimeout(() => resolve('late'), 1000));

    // CB_TIMEOUT_MS is 200, so this should reject with a Timed out error.
    await assert.rejects(breakers.fire(key, slow));

    const status = breakers.getStatus()[key];
    assert.equal(status.stats.timeouts >= 1, true, 'expected at least one timeout');
});

test('getStatus exposes per-breaker state, stats, and config', async () => {
    const key = nextKey('status');
    await breakers.fire(key, async () => 'ok');

    const all = breakers.getStatus();
    assert.ok(all[key], 'breaker should appear in status snapshot');
    assert.ok(['CLOSED', 'OPEN', 'HALF_OPEN'].includes(all[key].state));
    assert.equal(typeof all[key].stats.successes, 'number');
    assert.equal(typeof all[key].config.timeout, 'number');
    assert.equal(typeof all[key].config.errorThresholdPercentage, 'number');
});

test('isolated keys do not affect each other', async () => {
    const failingKey = nextKey('isolation-fail');
    const healthyKey = nextKey('isolation-ok');
    const failing = async () => { throw new Error('boom'); };

    for (let i = 0; i < 5; i++) {
        await assert.rejects(breakers.fire(failingKey, failing));
    }
    assert.equal(breakers.getStatus()[failingKey].state, 'OPEN');

    // Healthy key must still allow calls through.
    const result = await breakers.fire(healthyKey, async () => 'fine');
    assert.equal(result, 'fine');
    assert.equal(breakers.getStatus()[healthyKey].state, 'CLOSED');
});
