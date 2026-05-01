const CircuitBreaker = require('opossum');
const logger = require('../config/logger');

const DEFAULTS = {
    timeout: parseInt(process.env.CB_TIMEOUT_MS, 10) || 10000,
    errorThresholdPercentage: parseInt(process.env.CB_FAILURE_THRESHOLD, 10) || 50,
    resetTimeout: parseInt(process.env.CB_RESET_TIMEOUT_MS, 10) || 30000,
    volumeThreshold: parseInt(process.env.CB_VOLUME_THRESHOLD, 10) || 5,
    rollingCountTimeout: parseInt(process.env.CB_ROLLING_WINDOW_MS, 10) || 60000,
    rollingCountBuckets: 10,
};

class CircuitBreakerOpenError extends Error {
    constructor(key) {
        super(`Circuit breaker is OPEN for "${key}" — fast-failing request.`);
        this.name = 'CircuitBreakerOpenError';
        this.code = 'CIRCUIT_OPEN';
        this.breakerKey = key;
    }
}

class CircuitBreakerRegistry {
    constructor() {
        this.breakers = new Map();
    }

    /**
     * Get or create a circuit breaker for a given key.
     *
     * Internally we bind opossum to a generic dispatcher `(fn, args) => fn(...args)`
     * so each fire() call can supply its own action — opossum normally binds a
     * single action at construction. This lets us re-use one breaker per logical
     * downstream (e.g. one per webhook URL) regardless of which call site invokes it.
     *
     * @param {string} key - Unique identifier for this breaker (e.g. "slack", "webhook:<url>")
     * @param {object} options - Override defaults for this breaker
     * @returns {CircuitBreaker}
     */
    getBreaker(key, options = {}) {
        if (this.breakers.has(key)) {
            return this.breakers.get(key);
        }

        const dispatcher = (fn, args) => fn(...args);
        const breaker = new CircuitBreaker(dispatcher, {
            ...DEFAULTS,
            ...options,
            name: key,
        });

        breaker.on('open', () => {
            logger.warn('Circuit breaker OPENED', { key, stats: breaker.stats });
        });
        breaker.on('halfOpen', () => {
            logger.info('Circuit breaker HALF-OPEN — probing recovery', { key });
        });
        breaker.on('close', () => {
            logger.info('Circuit breaker CLOSED — recovered', { key });
        });
        breaker.on('reject', () => {
            logger.debug('Circuit breaker rejected call (still OPEN)', { key });
        });
        breaker.on('timeout', () => {
            logger.warn('Circuit breaker call timed out', { key });
        });

        this.breakers.set(key, breaker);
        return breaker;
    }

    /**
     * Execute an action via its circuit breaker. Translates opossum's generic
     * "Breaker is open" rejection into a typed CircuitBreakerOpenError so
     * callers can distinguish fast-fail from genuine downstream failures.
     */
    async fire(key, action, args = [], options = {}) {
        const breaker = this.getBreaker(key, options);
        try {
            return await breaker.fire(action, args);
        } catch (err) {
            if (breaker.opened && err && /Breaker is open/i.test(err.message || '')) {
                throw new CircuitBreakerOpenError(key);
            }
            throw err;
        }
    }

    /**
     * Snapshot of all breakers for monitoring endpoints.
     */
    getStatus() {
        const status = {};
        for (const [key, breaker] of this.breakers.entries()) {
            let state = 'CLOSED';
            if (breaker.opened) state = 'OPEN';
            else if (breaker.halfOpen) state = 'HALF_OPEN';

            const s = breaker.stats;
            status[key] = {
                state,
                stats: {
                    successes: s.successes,
                    failures: s.failures,
                    rejects: s.rejects,
                    timeouts: s.timeouts,
                    fires: s.fires,
                    fallbacks: s.fallbacks,
                    latencyMean: s.latencyMean,
                    percentiles: s.percentiles,
                },
                config: {
                    timeout: breaker.options.timeout,
                    errorThresholdPercentage: breaker.options.errorThresholdPercentage,
                    resetTimeout: breaker.options.resetTimeout,
                    volumeThreshold: breaker.options.volumeThreshold,
                },
            };
        }
        return status;
    }

    reset(key) {
        const breaker = this.breakers.get(key);
        if (breaker) breaker.close();
    }
}

const registry = new CircuitBreakerRegistry();

module.exports = registry;
module.exports.CircuitBreakerOpenError = CircuitBreakerOpenError;
