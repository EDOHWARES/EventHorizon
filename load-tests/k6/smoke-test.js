/**
 * Smoke test – runs on every PR in CI.
 *
 * Low VU count, short duration. Validates that the API is functional
 * and meets the performance budget before a PR can be merged.
 *
 * Run:
 *   k6 run load-tests/k6/smoke-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { SMOKE_OPTIONS } from './thresholds.js';
import { BASE_URL, TEST_USER, TRIGGER_PAYLOAD } from './config.js';

const errorRate = new Rate('error_rate');

export const options = SMOKE_OPTIONS;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function setup() {
  http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify(TEST_USER),
    { headers: JSON_HEADERS },
  );
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    { headers: JSON_HEADERS },
  );
  try { return { token: JSON.parse(res.body).token || '' }; } catch { return { token: '' }; }
}

export default function (data) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` };

  // Health
  const health = http.get(`${BASE_URL}/api/health`);
  errorRate.add(!check(health, { 'health 200': (r) => r.status === 200 }));

  // Auth
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    { headers: JSON_HEADERS },
  );
  errorRate.add(!check(login, { 'login 200': (r) => r.status === 200 }));

  // Trigger create + delete
  const create = http.post(
    `${BASE_URL}/api/triggers`,
    JSON.stringify(TRIGGER_PAYLOAD),
    { headers },
  );
  const created = check(create, { 'trigger create 201': (r) => r.status === 201 });
  errorRate.add(!created);

  if (created) {
    let id;
    try { id = JSON.parse(create.body)._id; } catch { /* noop */ }
    if (id) {
      const del = http.del(`${BASE_URL}/api/triggers/${id}`, null, { headers });
      errorRate.add(!check(del, { 'trigger delete 204': (r) => r.status === 204 }));
    }
  }

  // Queue stats (503 acceptable when Redis is absent)
  const stats = http.get(`${BASE_URL}/api/queue/stats`, { headers });
  errorRate.add(!check(stats, { 'queue stats ok': (r) => r.status === 200 || r.status === 503 }));

  sleep(1);
}
