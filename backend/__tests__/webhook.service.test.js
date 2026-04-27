const webhookService = require('../src/services/webhook.service');
const crypto = require('crypto');
const { test, describe, it } = require('node:test');
const assert = require('node:assert');

describe('WebhookService', () => {
    const mockSecret = 'test-secret-12345678901234567890123456789012';
    const mockTimestamp = '2024-01-01T12:00:00.000Z';
    const mockPayload = {
        contractId: 'CBQ2J...',
        eventName: 'transfer',
        payload: { from: 'GBX...', to: 'GDX...', amount: '1000000' }
    };

    describe('generateSignature', () => {
        test('should generate correct HMAC signature', () => {
            const signature = webhookService.generateSignature(mockSecret, mockTimestamp, mockPayload);

            // Manually verify the signature
            const expectedMessage = `${mockTimestamp}.${JSON.stringify(mockPayload)}`;
            const expectedSignature = crypto.createHmac('sha256', mockSecret)
                .update(expectedMessage)
                .digest('hex');

            assert.strictEqual(signature, expectedSignature);
        });

        test('should generate different signatures for different payloads', () => {
            const payload1 = { test: 'value1' };
            const payload2 = { test: 'value2' };

            const sig1 = webhookService.generateSignature(mockSecret, mockTimestamp, payload1);
            const sig2 = webhookService.generateSignature(mockSecret, mockTimestamp, payload2);

            assert.notStrictEqual(sig1, sig2);
        });

        test('should generate different signatures for different secrets', () => {
            const secret1 = 'secret1-12345678901234567890123456789012';
            const secret2 = 'secret2-12345678901234567890123456789012';

            const sig1 = webhookService.generateSignature(secret1, mockTimestamp, mockPayload);
            const sig2 = webhookService.generateSignature(secret2, mockTimestamp, mockPayload);

            assert.notStrictEqual(sig1, sig2);
        });
    });

    describe('verifySignature', () => {
        test('should verify correct signature', () => {
            const recentTimestamp = new Date().toISOString();
            const signature = webhookService.generateSignature(mockSecret, recentTimestamp, mockPayload);
            const isValid = webhookService.verifySignature(signature, recentTimestamp, mockPayload, mockSecret);

            assert.strictEqual(isValid, true);
        });

        test('should reject invalid signature', () => {
            const invalidSignature = 'invalid-signature';
            const isValid = webhookService.verifySignature(invalidSignature, mockTimestamp, mockPayload, mockSecret, 999999999);

            assert.strictEqual(isValid, false);
        });

        test('should reject signature with wrong secret', () => {
            const wrongSecret = 'wrong-secret-12345678901234567890123456789012';
            const signature = webhookService.generateSignature(wrongSecret, mockTimestamp, mockPayload);
            const isValid = webhookService.verifySignature(signature, mockTimestamp, mockPayload, mockSecret, 999999999);

            assert.strictEqual(isValid, false);
        });

        test('should reject signature with wrong payload', () => {
            const wrongPayload = { ...mockPayload, eventName: 'wrong' };
            const signature = webhookService.generateSignature(mockSecret, mockTimestamp, mockPayload);
            const isValid = webhookService.verifySignature(signature, mockTimestamp, wrongPayload, mockSecret, 999999999);

            assert.strictEqual(isValid, false);
        });
    });
});