/**
 * Triggers CRUD load test
 *
 * Exercises the full trigger lifecycle: create → list → update → versions → restore → delete.
 * Designed to simulate 5 000+ concurrent event trigger operations.
 *
 * Run:
 *   k6 run load-tests/k6/triggers-load-test.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_URL, TEST_USER, TRIGGER_PAYLOAD } from './config.js';

const createDuration  = new Trend('trigger_create_duration',  true);
const listDuration    = new Trend('trigger_list_duration',    true);
const updateDuration  = new Trend('trigger_update_duration',  true);
const deleteDuration  = new Trend('trigger_delete_duration',  true);
const errorRate       = new Rate('error_rate');
const triggersCreated = new Counter('triggers_created_total');

export const options = {
  stages: [
    { duration: '30s', target: 500  },
    { duration: '2m',  target: 5000 },
    { duration: '1m',  target: 5000 },
    { duration: '30s', target: 0    },
  ],
  thresholds: {
    trigger_create_duration: ['p(95)<600'],
    trigger_list_duration:   ['p(95)<400'],
    trigger_update_duration: ['p(95)<600'],
    trigger_delete_duration: ['p(95)<400'],
    error_rate:              ['rate<0.01'],
    http_req_failed:         ['rate<0.01'],
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

export default function () {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  let triggerId;

  // ── Create ────────────────────────────────────────────────────────────────
  group('create trigger', () => {
    const res = http.post(
      `${BASE_URL}/api/triggers`,
      JSON.stringify(TRIGGER_PAYLOAD),
      { headers },
    );
    createDuration.add(res.timings.duration);
    const ok = check(res, { 'create 201': (r) => r.status === 201 });
    errorRate.add(!ok);
    if (ok) {
      triggersCreated.add(1);
      try { triggerId = JSON.parse(res.body)._id; } catch { /* noop */ }
    }
  });

  // ── List ──────────────────────────────────────────────────────────────────
  group('list triggers', () => {
    const res = http.get(`${BASE_URL}/api/triggers`, { headers });
    listDuration.add(res.timings.duration);
    const ok = check(res, {
      'list 200':        (r) => r.status === 200,
      'list is array':   (r) => { try { return Array.isArray(JSON.parse(r.body)); } catch { return false; } },
    });
    errorRate.add(!ok);
  });

  if (!triggerId) { sleep(1); return; }

  // ── Update ────────────────────────────────────────────────────────────────
  group('update trigger', () => {
    const res = http.put(
      `${BASE_URL}/api/triggers/${triggerId}`,
      JSON.stringify({ ...TRIGGER_PAYLOAD, eventName: `swap_${__ITER}` }),
      { headers },
    );
    updateDuration.add(res.timings.duration);
    const ok = check(res, { 'update 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  // ── Versions ──────────────────────────────────────────────────────────────
  group('trigger versions', () => {
    const res = http.get(`${BASE_URL}/api/triggers/${triggerId}/versions`, { headers });
    check(res, { 'versions 200': (r) => r.status === 200 });

    // Restore version 1 if it exists
    let versions;
    try { versions = JSON.parse(res.body); } catch { versions = []; }
    if (Array.isArray(versions) && versions.length > 0) {
      const v = versions[0].version || 1;
      const restoreRes = http.post(
        `${BASE_URL}/api/triggers/${triggerId}/versions/${v}/restore`,
        null,
        { headers },
      );
      check(restoreRes, { 'restore 200': (r) => r.status === 200 });
    }
  });

  // ── Delete ────────────────────────────────────────────────────────────────
  group('delete trigger', () => {
    const res = http.del(`${BASE_URL}/api/triggers/${triggerId}`, null, { headers });
    deleteDuration.add(res.timings.duration);
    const ok = check(res, { 'delete 204': (r) => r.status === 204 });
    errorRate.add(!ok);
  });

  sleep(0.5);
}
