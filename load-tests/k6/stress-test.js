/**
 * EventHorizon API Stress Test
 *
 * Covers: auth, triggers CRUD, queue, discovery, and health endpoints.
 * Simulates 5 000 concurrent virtual users ramping up over 2 minutes.
 *
 * Run:
 *   k6 run load-tests/k6/stress-test.js
 *
 * With InfluxDB output:
 *   k6 run --out influxdb=http://localhost:8086/k6 load-tests/k6/stress-test.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_URL, TEST_USER, TRIGGER_PAYLOAD } from './config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const authDuration    = new Trend('auth_duration',    true);
const triggerDuration = new Trend('trigger_duration', true);
const queueDuration   = new Trend('queue_duration',   true);
const errorRate       = new Rate('error_rate');
const triggerCreated  = new Counter('triggers_created');

// ---------------------------------------------------------------------------
// Load profile – ramp to 5 000 VUs, sustain, then ramp down
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    { duration: '30s',  target: 100  },   // warm-up
    { duration: '1m',   target: 1000 },   // ramp-up
    { duration: '2m',   target: 5000 },   // peak load
    { duration: '1m',   target: 5000 },   // sustain peak
    { duration: '30s',  target: 0    },   // ramp-down
  ],
  thresholds: {
    // Import thresholds from thresholds.js so they stay in sync with PR gates
    http_req_duration:        ['p(95)<500', 'p(99)<1000'],
    http_req_failed:          ['rate<0.01'],
    error_rate:               ['rate<0.01'],
    auth_duration:            ['p(95)<300'],
    trigger_duration:         ['p(95)<500'],
    queue_duration:           ['p(95)<400'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Register + login and return a JWT access token.
 * Registration may fail with 409 (user already exists) – that is fine.
 */
function authenticate() {
  // Attempt registration (idempotent – ignore 409)
  http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      ...TEST_USER,
      // Make email unique per VU to avoid conflicts during ramp-up
      email: `loadtest+${__VU}@eventhorizon.dev`,
    }),
    { headers: JSON_HEADERS },
  );

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: `loadtest+${__VU}@eventhorizon.dev`, password: TEST_USER.password }),
    { headers: JSON_HEADERS },
  );

  authDuration.add(loginRes.timings.duration);

  const ok = check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'login has token':  (r) => {
      try { return !!JSON.parse(r.body).token; } catch { return false; }
    },
  });

  errorRate.add(!ok);

  try {
    return JSON.parse(loginRes.body).token || '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Setup – runs once before the test
// ---------------------------------------------------------------------------
export function setup() {
  // Ensure at least one user exists for the test
  http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify(TEST_USER),
    { headers: JSON_HEADERS },
  );
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    { headers: JSON_HEADERS },
  );
  try {
    return { token: JSON.parse(loginRes.body).token || '' };
  } catch {
    return { token: '' };
  }
}

// ---------------------------------------------------------------------------
// Default function – executed by every VU on every iteration
// ---------------------------------------------------------------------------
export default function (data) {
  const token = authenticate();
  const headers = authHeaders(token);

  // ── Health check ──────────────────────────────────────────────────────────
  group('health', () => {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, { 'health 200': (r) => r.status === 200 });
    errorRate.add(res.status !== 200);
  });

  sleep(0.1);

  // ── Triggers CRUD ─────────────────────────────────────────────────────────
  let triggerId;
  group('triggers', () => {
    // Create
    const createRes = http.post(
      `${BASE_URL}/api/triggers`,
      JSON.stringify(TRIGGER_PAYLOAD),
      { headers },
    );
    triggerDuration.add(createRes.timings.duration);
    const created = check(createRes, {
      'trigger create 201': (r) => r.status === 201,
    });
    errorRate.add(!created);

    if (created) {
      triggerCreated.add(1);
      try { triggerId = JSON.parse(createRes.body)._id; } catch { /* noop */ }
    }

    // List
    const listRes = http.get(`${BASE_URL}/api/triggers`, { headers });
    triggerDuration.add(listRes.timings.duration);
    check(listRes, { 'trigger list 200': (r) => r.status === 200 });
    errorRate.add(listRes.status !== 200);

    if (triggerId) {
      // Update
      const updateRes = http.put(
        `${BASE_URL}/api/triggers/${triggerId}`,
        JSON.stringify({ ...TRIGGER_PAYLOAD, eventName: 'swap' }),
        { headers },
      );
      triggerDuration.add(updateRes.timings.duration);
      check(updateRes, { 'trigger update 200': (r) => r.status === 200 });
      errorRate.add(updateRes.status !== 200);

      // Versions
      const versionsRes = http.get(`${BASE_URL}/api/triggers/${triggerId}/versions`, { headers });
      check(versionsRes, { 'trigger versions 200': (r) => r.status === 200 });

      // Delete
      const deleteRes = http.del(`${BASE_URL}/api/triggers/${triggerId}`, null, { headers });
      check(deleteRes, { 'trigger delete 204': (r) => r.status === 204 });
      errorRate.add(deleteRes.status !== 204);
    }
  });

  sleep(0.1);

  // ── Queue endpoints ───────────────────────────────────────────────────────
  group('queue', () => {
    const statsRes = http.get(`${BASE_URL}/api/queue/stats`, { headers });
    queueDuration.add(statsRes.timings.duration);
    // 200 = Redis available, 503 = Redis not configured (both acceptable)
    check(statsRes, { 'queue stats ok': (r) => r.status === 200 || r.status === 503 });

    const jobsRes = http.get(`${BASE_URL}/api/queue/jobs?status=failed&limit=10`, { headers });
    queueDuration.add(jobsRes.timings.duration);
    check(jobsRes, { 'queue jobs ok': (r) => r.status === 200 || r.status === 503 });

    const batchRes = http.get(`${BASE_URL}/api/queue/batches/stats`, { headers });
    queueDuration.add(batchRes.timings.duration);
    check(batchRes, { 'batch stats ok': (r) => r.status === 200 || r.status === 503 });
  });

  sleep(0.1);

  // ── Discovery ─────────────────────────────────────────────────────────────
  group('discovery', () => {
    const res = http.post(
      `${BASE_URL}/api/discovery/assign-poller`,
      JSON.stringify({ eventType: 'transfer', network: 'testnet' }),
      { headers },
    );
    // 200 = poller assigned, 503 = Consul not available (both acceptable in CI)
    check(res, { 'discovery ok': (r) => r.status === 200 || r.status === 503 || r.status === 404 });
  });

  sleep(0.5);
}
