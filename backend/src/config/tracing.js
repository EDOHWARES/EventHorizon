/**
 * OpenTelemetry tracing initialization for EventHorizon backend.
 *
 * This module is the single entry point for distributed-tracing setup.
 * It MUST be required before any instrumented library (express, mongoose,
 * ioredis, http) so the auto-instrumentation can patch them at load time.
 *
 * Tracing is opt-in via OTEL_ENABLED=true. When disabled, this module is a
 * no-op and the helpers in utils/tracing.js fall back to the OTel API's
 * built-in no-op tracer, so nothing in the request path changes.
 */

const TRACING_ENV_FLAG = 'OTEL_ENABLED';

let sdk = null;
let initialized = false;
let initError = null;

function isEnabled() {
    return String(process.env[TRACING_ENV_FLAG] || '').toLowerCase() === 'true';
}

function getServiceName() {
    return process.env.OTEL_SERVICE_NAME || 'eventhorizon-backend';
}

function getServiceVersion() {
    return process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || '1.0.0';
}

function getDeploymentEnvironment() {
    return process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || 'development';
}

/**
 * Build the configured exporter. Supported values for OTEL_EXPORTER:
 *   - "otlp"    (default) — OTLP/HTTP exporter, defaults to http://localhost:4318/v1/traces
 *   - "jaeger"  — Jaeger exporter, defaults to http://localhost:14268/api/traces
 *   - "console" — log spans to stdout (useful for local dev)
 *   - "none"    — no exporter; spans are created but not exported
 */
function buildExporter() {
    const exporterName = (process.env.OTEL_EXPORTER || 'otlp').toLowerCase();

    if (exporterName === 'none') {
        // Use an in-memory exporter so spans are produced (and visible to
        // tests via the SDK) but never sent over the network. Returning
        // null here would let NodeSDK fall back to its default OTLP
        // exporter, which would try to connect to localhost:4318.
        const { InMemorySpanExporter } = require('@opentelemetry/sdk-trace-base');
        return new InMemorySpanExporter();
    }

    if (exporterName === 'console') {
        const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
        return new ConsoleSpanExporter();
    }

    if (exporterName === 'jaeger') {
        const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
        return new JaegerExporter({
            endpoint: process.env.OTEL_EXPORTER_JAEGER_ENDPOINT
                || 'http://localhost:14268/api/traces',
        });
    }

    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    return new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
            || 'http://localhost:4318/v1/traces',
    });
}

/**
 * Initialize the OpenTelemetry SDK.
 *
 * Returns the SDK instance on success, or null if tracing is disabled or
 * the OpenTelemetry packages are not installed. Errors during initialization
 * are captured and surfaced via getInitError() so callers can log them
 * without crashing the app.
 */
function start() {
    if (initialized) {
        return sdk;
    }
    initialized = true;

    if (!isEnabled()) {
        return null;
    }

    try {
        const { NodeSDK } = require('@opentelemetry/sdk-node');
        const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
        const { Resource } = require('@opentelemetry/resources');
        const {
            SemanticResourceAttributes,
        } = require('@opentelemetry/semantic-conventions');

        const resource = new Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: getServiceName(),
            [SemanticResourceAttributes.SERVICE_VERSION]: getServiceVersion(),
            [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: getDeploymentEnvironment(),
        });

        const exporter = buildExporter();

        sdk = new NodeSDK({
            resource,
            traceExporter: exporter,
            instrumentations: [
                getNodeAutoInstrumentations({
                    '@opentelemetry/instrumentation-fs': { enabled: false },
                }),
            ],
        });

        sdk.start();
        return sdk;
    } catch (error) {
        initError = error;
        sdk = null;
        return null;
    }
}

async function shutdown() {
    if (!sdk) return;
    try {
        await sdk.shutdown();
    } finally {
        sdk = null;
        initialized = false;
    }
}

function getInitError() {
    return initError;
}

function isInitialized() {
    return Boolean(sdk);
}

function _resetForTests() {
    sdk = null;
    initialized = false;
    initError = null;
}

module.exports = {
    start,
    shutdown,
    isEnabled,
    isInitialized,
    getInitError,
    getServiceName,
    _resetForTests,
};
