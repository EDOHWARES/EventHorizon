const { setAttributes, getCurrentTraceId } = require('../utils/tracing');

/**
 * Express middleware that enriches the active HTTP server span with
 * application-level attributes (route, user id) and exposes the current
 * trace id on the request and response so logs and clients can correlate.
 *
 * The HTTP server span itself is created by the auto-instrumentation; this
 * middleware only annotates it.
 */
function tracingMiddleware(req, res, next) {
    const traceId = getCurrentTraceId();
    if (traceId) {
        req.traceId = traceId;
        res.setHeader('x-trace-id', traceId);
    }

    const attrs = {
        'http.route': req.route?.path || req.originalUrl || req.url,
    };
    if (req.user?.id) {
        attrs['enduser.id'] = String(req.user.id);
    }
    if (req.user?.role) {
        attrs['enduser.role'] = String(req.user.role);
    }
    setAttributes(attrs);

    next();
}

module.exports = { tracingMiddleware };
