/**
 * EventHorizon Performance Budget
 *
 * Import this file into any k6 script to apply the standard PR thresholds:
 *
 *   import { THRESHOLDS } from './thresholds.js';
 *   export const options = { thresholds: THRESHOLDS, stages: [...] };
 *
 * These values are the acceptance gates for every pull request.
 * A PR that causes any threshold to be breached MUST NOT be merged.
 *
 * Threshold reference:
 *   https://k6.io/docs/using-k6/thresholds/
 */

/**
 * Standard performance budget applied to all PR load tests.
 *
 * Metric                  | Budget          | Rationale
 * ----------------------- | --------------- | ------------------------------------------
 * http_req_duration p(95) | < 500 ms        | 95 % of requests must be fast
 * http_req_duration p(99) | < 1 000 ms      | Tail latency cap
 * http_req_failed         | < 1 %           | Error rate cap
 * http_req_duration avg   | < 200 ms        | Average response time
 * auth_duration p(95)     | < 300 ms        | Auth endpoints must be snappy
 * trigger_duration p(95)  | < 500 ms        | Trigger CRUD latency cap
 * queue_duration p(95)    | < 400 ms        | Queue read latency cap
 * error_rate              | < 1 %           | Custom error counter cap
 */
export const THRESHOLDS = {
  // Global HTTP metrics
  http_req_duration: ['p(95)<500', 'p(99)<1000', 'avg<200'],
  http_req_failed:   ['rate<0.01'],

  // Custom per-feature metrics (defined in individual test scripts)
  auth_duration:    ['p(95)<300'],
  trigger_duration: ['p(95)<500'],
  queue_duration:   ['p(95)<400'],
  error_rate:       ['rate<0.01'],
};

/**
 * Smoke-test options – used in CI on every PR to catch regressions quickly.
 * Low VU count, short duration, strict thresholds.
 */
export const SMOKE_OPTIONS = {
  vus:      10,
  duration: '30s',
  thresholds: THRESHOLDS,
};

/**
 * Soak-test options – run nightly to detect memory leaks and slow degradation.
 */
export const SOAK_OPTIONS = {
  stages: [
    { duration: '5m',  target: 500  },
    { duration: '30m', target: 500  },
    { duration: '5m',  target: 0    },
  ],
  thresholds: {
    ...THRESHOLDS,
    // Slightly relaxed for long-running soak
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
  },
};

/**
 * Spike-test options – validates behaviour under sudden traffic bursts.
 */
export const SPIKE_OPTIONS = {
  stages: [
    { duration: '10s', target: 100  },
    { duration: '1m',  target: 5000 },  // sudden spike
    { duration: '10s', target: 100  },
    { duration: '30s', target: 0    },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],   // allow slightly higher error rate during spike
    error_rate:      ['rate<0.05'],
  },
};
