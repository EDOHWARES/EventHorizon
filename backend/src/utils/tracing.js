/**
 * Tracing helpers — thin wrappers over @opentelemetry/api.
 *
 * These functions are safe to call whether or not the SDK has been
 * initialized. When the SDK is absent the OpenTelemetry API returns
 * built-in no-op implementations, so wrapped code paths behave normally
 * with zero overhead beyond a couple of function calls.
 */

let api;
try {
    api = require('@opentelemetry/api');
} catch (_e) {
    // The api package is intentionally optional here so that the backend
    // boots even when OpenTelemetry dependencies aren't installed (e.g.
    // a minimal/legacy deployment). All exports below degrade to no-ops.
    api = null;
}

const TRACER_NAME = 'eventhorizon-backend';

function getTracer() {
    if (!api) return null;
    return api.trace.getTracer(TRACER_NAME);
}

/**
 * Run `fn` inside a span named `name`. The span is ended automatically.
 * If `fn` throws or returns a rejected promise, the error is recorded on
 * the span and the span status is set to ERROR before re-throwing.
 *
 *     const result = await withSpan('worker.action.execute',
 *         async (span) => { ... },
 *         { 'trigger.id': trigger._id, 'action.type': trigger.actionType });
 */
async function withSpan(name, fn, attributes = {}) {
    const tracer = getTracer();
    if (!tracer) {
        return fn(null);
    }

    return tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
            const result = await fn(span);
            span.setStatus({ code: api.SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.recordException(error);
            span.setStatus({
                code: api.SpanStatusCode.ERROR,
                message: error?.message || String(error),
            });
            throw error;
        } finally {
            span.end();
        }
    });
}

function setAttributes(attributes) {
    if (!api) return;
    const span = api.trace.getActiveSpan();
    if (span && attributes) {
        span.setAttributes(attributes);
    }
}

function getCurrentTraceId() {
    if (!api) return null;
    const span = api.trace.getActiveSpan();
    if (!span) return null;
    const ctx = span.spanContext();
    return ctx?.traceId || null;
}

/**
 * Serialize the active trace context into a plain object suitable for
 * embedding in a queue message. The receiving side calls
 * `runWithExtractedContext` to continue the same trace.
 */
function injectContextIntoCarrier(carrier = {}) {
    if (!api) return carrier;
    api.propagation.inject(api.context.active(), carrier);
    return carrier;
}

/**
 * Run `fn` with the trace context extracted from `carrier`. Used by the
 * BullMQ worker to stitch a job's span onto the producer's trace.
 */
function runWithExtractedContext(carrier, fn) {
    if (!api || !carrier) return fn();
    const ctx = api.propagation.extract(api.context.active(), carrier);
    return api.context.with(ctx, fn);
}

module.exports = {
    getTracer,
    withSpan,
    setAttributes,
    getCurrentTraceId,
    injectContextIntoCarrier,
    runWithExtractedContext,
};
