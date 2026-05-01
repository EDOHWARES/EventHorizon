/**
 * Queue & Batch endpoints load test
 *
 * Exercises: /api/queue/stats, /api/queue/jobs, /api/queue/batches/stats,
 *            /api/queue/batches/flush, /api/queue/clean
 *
 * Run:
 *   k6 run load-tests/k6/queue-load-test.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, TEST_USER } from './config.js';

const statsDuration = new Trend('queue_stats_duration', true);
const jobsDuration  = new Trend('queue_jobs_duration',  true);
const errorRate     = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '30s', target: 200  },
    { duration: '1m',  target: 2000 },
    { duration: '1m',  target: 2000 },
    { duration: '30s', target: 0    },
  ],
  thresholds: {
    queue_stats_duration: ['p(95)<400'],
    queue_jobs_duration:  ['p(95)<400'],
    error_rate:           ['rate<0.01'],
    http_req_failed:      ['rate<0.01'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function getToken() {
  const email = `loadtest+${__VU}@eventhorizon.dev`;
  http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ ...TEST_USER, email }),
    { headers: JSON_HEADERS },
  );
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password: TEST_USER.password }),
    { headers: JSON_HEADERS },
  );
  try { return JSON.parse(res.body).token || ''; } catch { return ''; }
}

// Acceptable statuses: 200 (Redis up) or 503 (Redis not configured)
const queueOk = (r) => r.status === 200 || r.status === 503;

export default function () {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  group('queue stats', () => {
    const res = http.get(`${BASE_URL}/api/queue/stats`, { headers });
    statsDuration.add(res.timings.duration);
    const ok = check(res, { 'stats ok': queueOk });
    errorRate.add(!ok);
  });

  group('queue jobs', () => {
    for (const status of ['waiting', 'active', 'completed', 'failed']) {
      const res = http.get(`${BASE_URL}/api/queue/jobs?status=${status}&limit=20`, { headers });
      jobsDuration.add(res.timings.duration);
      const ok = check(res, { [`jobs ${status} ok`]: queueOk });
      errorRate.add(!ok);
    }
  });

  group('batch stats', () => {
    const res = http.get(`${BASE_URL}/api/queue/batches/stats`, { headers });
    const ok = check(res, { 'batch stats ok': queueOk });
    errorRate.add(!ok);
  });

  // Flush batches (write operation – lower frequency)
  if (__ITER % 10 === 0) {
    group('batch flush', () => {
      const res = http.post(`${BASE_URL}/api/queue/batches/flush`, null, { headers });
      check(res, { 'batch flush ok': queueOk });
    });
  }

  sleep(1);
}
