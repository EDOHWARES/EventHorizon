const { describe, it } = require('node:test');
const assert = require('node:assert');
const auth0Service = require('../src/services/auth0.service');

describe('Auth0Service', () => {
    describe('mapRoles', () => {
        it('should map eh_admin to Owner', () => {
            const result = auth0Service.mapRoles(['eh_admin', 'other']);
            assert.strictEqual(result, 'Owner');
        });

        it('should map eh_editor to Member', () => {
            const result = auth0Service.mapRoles(['eh_editor']);
            assert.strictEqual(result, 'Member');
        });

        it('should return Member by default', () => {
            const result = auth0Service.mapRoles(['unsupported']);
            assert.strictEqual(result, 'Member');
        });

        it('should handle empty or null roles', () => {
            assert.strictEqual(auth0Service.mapRoles([]), 'Member');
            assert.strictEqual(auth0Service.mapRoles(null), 'Member');
        });
    });
});
