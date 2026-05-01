'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VERSION_REGISTRY,
  semverForSchemaVersion,
  latestKnownSchemaVersion,
  checkOnChainVersion,
} = require('../src/config/escrowVersions');

// ── VERSION_REGISTRY ──────────────────────────────────────────────────────────

test('VERSION_REGISTRY is frozen and non-empty', () => {
  assert.ok(Object.isFrozen(VERSION_REGISTRY));
  assert.ok(Object.keys(VERSION_REGISTRY).length > 0);
});

test('VERSION_REGISTRY values are positive integers', () => {
  for (const v of Object.values(VERSION_REGISTRY)) {
    assert.ok(Number.isInteger(v) && v > 0, `Expected positive integer, got ${v}`);
  }
});

// ── semverForSchemaVersion ────────────────────────────────────────────────────

test('semverForSchemaVersion returns correct semver for known version', () => {
  // Every registry entry should round-trip.
  for (const [semver, sv] of Object.entries(VERSION_REGISTRY)) {
    assert.equal(semverForSchemaVersion(sv), semver);
  }
});

test('semverForSchemaVersion returns null for unknown version', () => {
  assert.equal(semverForSchemaVersion(9999), null);
  assert.equal(semverForSchemaVersion(0), null);
});

// ── latestKnownSchemaVersion ──────────────────────────────────────────────────

test('latestKnownSchemaVersion returns the maximum registry value', () => {
  const expected = Math.max(...Object.values(VERSION_REGISTRY));
  assert.equal(latestKnownSchemaVersion(), expected);
});

// ── checkOnChainVersion ───────────────────────────────────────────────────────

test('checkOnChainVersion throws when LIQUIFACT_ESCROW_CONTRACT_ID is unset', async () => {
  const saved = process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;

  await assert.rejects(
    () => checkOnChainVersion(),
    /LIQUIFACT_ESCROW_CONTRACT_ID is not set/
  );

  if (saved !== undefined) process.env.LIQUIFACT_ESCROW_CONTRACT_ID = saved;
});

test('checkOnChainVersion returns correct shape for a known version', async () => {
  process.env.LIQUIFACT_ESCROW_CONTRACT_ID = 'CTEST000';

  const latestSv = latestKnownSchemaVersion();
  const result = await checkOnChainVersion({
    fetchSchemaVersion: async () => latestSv,
  });

  assert.equal(result.onChainVersion, latestSv);
  assert.equal(typeof result.semver, 'string');
  assert.equal(result.isLatest, true);
  assert.equal(result.latestKnown, latestSv);

  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
});

test('checkOnChainVersion isLatest=false when on-chain version is older', async () => {
  process.env.LIQUIFACT_ESCROW_CONTRACT_ID = 'CTEST001';

  const result = await checkOnChainVersion({
    fetchSchemaVersion: async () => 1,
  });

  assert.equal(result.onChainVersion, 1);
  assert.equal(result.isLatest, false);

  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
});

test('checkOnChainVersion semver is null for unregistered on-chain version', async () => {
  process.env.LIQUIFACT_ESCROW_CONTRACT_ID = 'CTEST002';

  const result = await checkOnChainVersion({
    fetchSchemaVersion: async () => 9999,
  });

  assert.equal(result.semver, null);
  assert.equal(result.isLatest, true); // 9999 >= latestKnown

  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
});

test('checkOnChainVersion propagates errors from fetchSchemaVersion', async () => {
  process.env.LIQUIFACT_ESCROW_CONTRACT_ID = 'CTEST003';

  await assert.rejects(
    () =>
      checkOnChainVersion({
        fetchSchemaVersion: async () => {
          throw new Error('RPC timeout');
        },
      }),
    /RPC timeout/
  );

  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
});

// ── /api/escrow/refresh route ─────────────────────────────────────────────────

// Minimal Express-like request/response helpers for unit-testing the route
// handler without starting a real HTTP server.

function makeReq(overrides = {}) {
  return {
    headers: {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// Load the router and extract the POST /refresh handler directly.
const escrowRouter = require('../src/routes/escrow.routes');

// Walk the router's stack to find the POST /refresh layer.
function findHandler(router, method, path) {
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  return null;
}

const refreshHandlers = findHandler(escrowRouter, 'post', '/refresh');
assert.ok(refreshHandlers, 'POST /refresh route must exist');

const [adminAuthFn, refreshFn] = refreshHandlers;

test('POST /refresh returns 401 when X-Admin-Token header is missing', () => {
  process.env.ADMIN_ACCESS_TOKEN = 'secret';
  const req = makeReq({ headers: {} });
  const res = makeRes();
  let nextCalled = false;

  adminAuthFn(req, res, () => { nextCalled = true; });

  assert.equal(res._status, 401);
  assert.equal(res._body.success, false);
  assert.ok(!nextCalled);

  delete process.env.ADMIN_ACCESS_TOKEN;
});

test('POST /refresh returns 403 when X-Admin-Token is wrong', () => {
  process.env.ADMIN_ACCESS_TOKEN = 'correct-secret';
  const req = makeReq({ headers: { 'x-admin-token': 'wrong' } });
  const res = makeRes();
  let nextCalled = false;

  adminAuthFn(req, res, () => { nextCalled = true; });

  assert.equal(res._status, 403);
  assert.equal(res._body.success, false);
  assert.ok(!nextCalled);

  delete process.env.ADMIN_ACCESS_TOKEN;
});

test('POST /refresh returns 503 when ADMIN_ACCESS_TOKEN is not configured', () => {
  delete process.env.ADMIN_ACCESS_TOKEN;
  const req = makeReq({ headers: { 'x-admin-token': 'anything' } });
  const res = makeRes();

  adminAuthFn(req, res, () => {});

  assert.equal(res._status, 503);
  assert.equal(res._body.success, false);
});

test('POST /refresh passes auth and returns version data when token is correct', async () => {
  process.env.ADMIN_ACCESS_TOKEN = 'secret';
  process.env.LIQUIFACT_ESCROW_CONTRACT_ID = 'CTEST_ROUTE';

  const req = makeReq({ headers: { 'x-admin-token': 'secret' } });
  const res = makeRes();

  // Patch via the same require path the route uses so we hit the same cache entry.
  const escrowVersions = require('../src/config/escrowVersions');
  const original = escrowVersions.checkOnChainVersion;
  const latestSv = latestKnownSchemaVersion();
  escrowVersions.checkOnChainVersion = async () => ({
    onChainVersion: latestSv,
    semver: '2.0.0',
    isLatest: true,
    latestKnown: latestSv,
  });

  await refreshFn(req, res, () => {});

  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(typeof res._body.data.onChainVersion, 'number');
  assert.equal(typeof res._body.data.refreshTriggered, 'boolean');

  escrowVersions.checkOnChainVersion = original;
  delete process.env.ADMIN_ACCESS_TOKEN;
  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
});

test('POST /refresh returns 500 when version check throws', async () => {
  process.env.ADMIN_ACCESS_TOKEN = 'secret';
  process.env.LIQUIFACT_ESCROW_CONTRACT_ID = 'CTEST_ERR';

  const req = makeReq({ headers: { 'x-admin-token': 'secret' } });
  const res = makeRes();

  const escrowVersions = require('../src/config/escrowVersions');
  const original = escrowVersions.checkOnChainVersion;
  escrowVersions.checkOnChainVersion = async () => {
    throw new Error('chain unreachable');
  };

  await refreshFn(req, res, () => {});

  assert.equal(res._status, 500);
  assert.equal(res._body.success, false);
  assert.match(res._body.error, /chain unreachable/);

  escrowVersions.checkOnChainVersion = original;
  delete process.env.ADMIN_ACCESS_TOKEN;
  delete process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
});
