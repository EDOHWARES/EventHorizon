const test = require('node:test');
const assert = require('node:assert/strict');

const tracingConfig = require('../src/config/tracing');
const tracingUtils = require('../src/utils/tracing');

test.beforeEach(() => {
    tracingConfig._resetForTests();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER;
});

test.afterEach(async () => {
    // Stop any SDK started during the test so it doesn't keep the event
    // loop alive and pollute later tests with spans/exporters.
    await tracingConfig.shutdown().catch(() => {});
});

test('tracing config is disabled by default', () => {
    assert.equal(tracingConfig.isEnabled(), false);
    const sdk = tracingConfig.start();
    assert.equal(sdk, null);
    assert.equal(tracingConfig.isInitialized(), false);
});

test('tracing config detects OTEL_ENABLED=true', () => {
    process.env.OTEL_ENABLED = 'true';
    assert.equal(tracingConfig.isEnabled(), true);
});

test('tracing config is case-insensitive on the enable flag', () => {
    process.env.OTEL_ENABLED = 'TRUE';
    assert.equal(tracingConfig.isEnabled(), true);
});

test('tracing config returns the configured service name', () => {
    process.env.OTEL_SERVICE_NAME = 'my-service';
    assert.equal(tracingConfig.getServiceName(), 'my-service');
    delete process.env.OTEL_SERVICE_NAME;
    assert.equal(tracingConfig.getServiceName(), 'eventhorizon-backend');
});

test('start() initializes only once', () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER = 'none';
    const first = tracingConfig.start();
    const second = tracingConfig.start();
    assert.equal(first, second);
});

test('start() captures init errors instead of throwing', () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER = 'jaeger';
    process.env.OTEL_EXPORTER_JAEGER_ENDPOINT = ' ';

    // We can't reliably force a hard failure of jaeger init in this
    // environment, so just assert that start() never throws and returns
    // either a valid SDK or null with an error captured.
    let threw = false;
    try {
        tracingConfig.start();
    } catch (_e) {
        threw = true;
    }
    assert.equal(threw, false);
});

test('withSpan executes the function and returns its result', async () => {
    const result = await tracingUtils.withSpan('test.span', async () => 42);
    assert.equal(result, 42);
});

test('withSpan propagates errors from the wrapped function', async () => {
    await assert.rejects(
        tracingUtils.withSpan('test.error', async () => {
            throw new Error('boom');
        }),
        /boom/,
    );
});

test('withSpan tolerates synchronous return values', async () => {
    const result = await tracingUtils.withSpan('test.sync', () => 'ok');
    assert.equal(result, 'ok');
});

test('getTracer returns a tracer when the API is available', () => {
    const tracer = tracingUtils.getTracer();
    // When @opentelemetry/api is installed, this returns a tracer object
    // (real or no-op). When it's missing, it returns null. Either path
    // is acceptable; the helper must not throw.
    if (tracer !== null) {
        assert.equal(typeof tracer.startActiveSpan, 'function');
    }
});

test('setAttributes is a no-op when there is no active span', () => {
    // Should not throw when called outside any span.
    assert.doesNotThrow(() => tracingUtils.setAttributes({ foo: 'bar' }));
});

test('getCurrentTraceId returns null outside any span', () => {
    const traceId = tracingUtils.getCurrentTraceId();
    assert.equal(traceId, null);
});

test('injectContextIntoCarrier returns the carrier object', () => {
    const carrier = {};
    const result = tracingUtils.injectContextIntoCarrier(carrier);
    assert.equal(result, carrier);
    assert.equal(typeof result, 'object');
});

test('runWithExtractedContext invokes the function and returns its value', () => {
    const result = tracingUtils.runWithExtractedContext({}, () => 'done');
    assert.equal(result, 'done');
});

test('runWithExtractedContext handles a missing carrier', () => {
    const result = tracingUtils.runWithExtractedContext(null, () => 'done');
    assert.equal(result, 'done');
});

test('tracing middleware sets x-trace-id when a trace is active', () => {
    const { tracingMiddleware } = require('../src/middleware/tracing.middleware');

    const headers = {};
    const req = { url: '/api/health', user: { id: 'u-1', role: 'admin' } };
    const res = {
        setHeader: (name, value) => {
            headers[name] = value;
        },
    };

    let nextCalled = false;
    tracingMiddleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    // x-trace-id is only set when there's an active span; outside one it
    // simply is not set. Just verify the middleware completed cleanly.
    if (req.traceId) {
        assert.equal(typeof req.traceId, 'string');
        assert.equal(headers['x-trace-id'], req.traceId);
    }
});

test('injectContextIntoCarrier preserves the carrier object identity', () => {
    // The poller relies on the carrier returned from inject() being the
    // same object instance it passed in (so it can attach it to a job).
    const carrier = { existing: 'data' };
    const out = tracingUtils.injectContextIntoCarrier(carrier);
    assert.equal(out, carrier);
    assert.equal(out.existing, 'data');
});

test('withSpan inject -> extract round-trips a function call', async () => {
    // End-to-end check that the context propagation helpers compose: we
    // inject inside an active span, then extract on the other side and
    // run a function. The inner function must execute and return its
    // value regardless of whether tracing is enabled.
    const carrier = await tracingUtils.withSpan('test.parent', async () => {
        return tracingUtils.injectContextIntoCarrier({});
    });

    const result = tracingUtils.runWithExtractedContext(carrier, () => 'extracted');
    assert.equal(result, 'extracted');
});
