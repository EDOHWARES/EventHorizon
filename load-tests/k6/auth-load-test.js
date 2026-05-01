/**
 * Auth endpoint load test
 *
 * Focuses on login / register / token-refresh throughput.
 * Useful for validating rate-limiter behaviour under load.
 *
 * Run:
 *   k6 run load-tests/k6/auth-load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, TEST_USER } from './config.js';

const loginDuration   = new Trend('login_duration',   true);
const refreshDuration = new Trend('refresh_duration', true);
const errorRate       = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '30s', target: 200  },
    { duration: '1m',  target: 1000 },
    { duration: '1m',  target: 1000 },
    { duration: '30s', target: 0    },
  ],
  thresholds: {
    login_duration:   ['p(95)<300'],
    refresh_duration: ['p(95)<200'],
    error_rate:       ['rate<0.02'],
    http_req_failed:  ['rate<0.02'],
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function setup() {
  // Pre-create the shared test user
  http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify(TEST_USER),
    { headers: JSON_HEADERS },
  );
}

export default function () {
  // Each VU uses a unique email to avoid lock-out from rate limiting
  const email = `loadtest+${__VU}@eventhorizon.dev`;
  const password = TEST_USER.password;

  // Register (idempotent)
  http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ ...TEST_USER, email }),
    { headers: JSON_HEADERS },
  );

  // Login
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: JSON_HEADERS },
  );
  loginDuration.add(loginRes.timings.duration);

  const loginOk = check(loginRes, {
    'login 200':    (r) => r.status === 200,
    'has token':    (r) => { try { return !!JSON.parse(r.body).token; } catch { return false; } },
    'has refresh':  (r) => { try { return !!JSON.parse(r.body).refreshToken; } catch { return false; } },
  });
  errorRate.add(!loginOk);

  let refreshToken;
  try { refreshToken = JSON.parse(loginRes.body).refreshToken; } catch { /* noop */ }

  // Token refresh
  if (refreshToken) {
    const refreshRes = http.post(
      `${BASE_URL}/api/auth/refresh`,
      JSON.stringify({ refreshToken }),
      { headers: JSON_HEADERS },
    );
    refreshDuration.add(refreshRes.timings.duration);
    const refreshOk = check(refreshRes, {
      'refresh 200': (r) => r.status === 200,
    });
    errorRate.add(!refreshOk);
  }

  sleep(1);
}
