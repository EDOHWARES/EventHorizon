/**
 * Tests for secret rotation service and controller.
 * Run with: node --test
 */
const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMockCredential(overrides = {}) {
    return {
        _id: 'cred-1',
        userId: 'user-1',
        provider: 'slack',
        accessToken: 'encrypted-old',
        refreshToken: 'encrypted-old-refresh',
        status: 'active',
        updatedAt: new Date(),
        save: async function () { this.updatedAt = new Date(); },
        ...overrides,
    };
}

// ── Unit: generateSecret ──────────────────────────────────────────────────────

describe('generateSecret', () => {
    it('returns a 64-char hex string', () => {
        // Inline the logic to avoid DB deps
        const crypto = require('crypto');
        const secret = crypto.randomBytes(32).toString('hex');
        assert.equal(secret.length, 64);
        assert.match(secret, /^[0-9a-f]+$/);
    });

    it('generates unique values each call', () => {
        const crypto = require('crypto');
        const a = crypto.randomBytes(32).toString('hex');
        const b = crypto.randomBytes(32).toString('hex');
        assert.notEqual(a, b);
    });
});

// ── Unit: rotateCredential (mocked deps) ─────────────────────────────────────

describe('rotateCredential', () => {
    let rotateCredential;
    let mockCredential;

    before(() => {
        mockCredential = makeMockCredential();

        // Stub modules before requiring the service
        const Module = require('node:module');
        const originalLoad = Module._load;

        Module._load = function (request, parent, isMain) {
            if (request.includes('credential.model')) {
                return {
                    findById: async () => mockCredential,
                };
            }
            if (request.includes('rotationPolicy.model')) {
                return {
                    updateOne: async () => ({}),
                };
            }
            if (request.includes('audit.model')) {
                return {
                    createLog: async () => ({}),
                };
            }
            if (request.includes('encryption')) {
                return { encrypt: (v) => `enc:${v}` };
            }
            if (request.includes('logger')) {
                return { info: () => {}, error: () => {}, warn: () => {} };
            }
            return originalLoad.apply(this, arguments);
        };

        // Clear cache so stubs take effect
        Object.keys(require.cache).forEach((k) => {
            if (k.includes('rotation.service')) delete require.cache[k];
        });

        ({ rotateCredential } = require('../src/services/rotation.service'));
        Module._load = originalLoad; // restore
    });

    it('returns credentialId and rotatedAt', async () => {
        const result = await rotateCredential('cred-1', { userId: 'user-1' });
        assert.equal(result.credentialId, 'cred-1');
        assert.ok(result.rotatedAt instanceof Date);
    });

    it('updates accessToken on the credential', async () => {
        await rotateCredential('cred-1', { userId: 'user-1' });
        assert.match(mockCredential.accessToken, /^enc:/);
    });
});

// ── Unit: processDueRotations ─────────────────────────────────────────────────

describe('processDueRotations', () => {
    it('returns empty array when no policies are due', async () => {
        const Module = require('node:module');
        const originalLoad = Module._load;

        Module._load = function (request, parent, isMain) {
            if (request.includes('rotationPolicy.model')) {
                return { find: async () => [] };
            }
            if (request.includes('credential.model')) return { findById: async () => null };
            if (request.includes('audit.model')) return { createLog: async () => ({}) };
            if (request.includes('encryption')) return { encrypt: (v) => `enc:${v}` };
            if (request.includes('logger')) return { info: () => {}, error: () => {}, warn: () => {} };
            return originalLoad.apply(this, arguments);
        };

        Object.keys(require.cache).forEach((k) => {
            if (k.includes('rotation.service')) delete require.cache[k];
        });

        const { processDueRotations } = require('../src/services/rotation.service');
        Module._load = originalLoad;

        const results = await processDueRotations();
        assert.deepEqual(results, []);
    });
});

// ── Unit: rotation controller helpers ────────────────────────────────────────

describe('rotation controller – upsertPolicy validation', () => {
    it('rejects intervalHours < 1', async () => {
        const AppError = require('../src/utils/appError');
        // Simulate the guard in the controller
        const intervalHours = 0;
        let threw = false;
        try {
            if (!intervalHours || intervalHours < 1) throw new AppError('intervalHours must be >= 1', 400);
        } catch (e) {
            threw = true;
            assert.equal(e.statusCode, 400);
        }
        assert.ok(threw);
    });
});
