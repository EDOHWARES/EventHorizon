const { test, describe } = require('node:test');
const assert = require('node:assert').strict;
const { buildHeaders, validateHeaders } = require('../src/utils/headerBuilder');

describe('HeaderBuilder', () => {
    describe('buildHeaders', () => {
        const mockPayload = {
            user: {
                id: '12345',
                name: 'John Doe',
                email: 'john@example.com'
            },
            contractId: 'CBTEST...',
            eventName: 'transfer'
        };

        test('should build headers from static values', () => {
            const customHeaders = [
                { key: 'Content-Type', value: 'application/json' },
                { key: 'X-Custom-Header', value: 'static-value' }
            ];

            const headers = buildHeaders(customHeaders, mockPayload);
            
            // Note: Content-Type is blocked as unsafe header, so it won't be included
            assert.deepStrictEqual(headers, {
                'X-Custom-Header': 'static-value'
            });
        });

        test('should resolve JSONPath expressions', () => {
            const customHeaders = [
                { key: 'X-User-ID', value: '$.user.id' },
                { key: 'X-User-Name', value: '$.user.name' },
                { key: 'X-Contract-ID', value: '$.contractId' }
            ];

            const headers = buildHeaders(customHeaders, mockPayload);
            
            assert.deepStrictEqual(headers, {
                'X-User-ID': '12345',
                'X-User-Name': 'John Doe',
                'X-Contract-ID': 'CBTEST...'
            });
        });

        test('should handle missing JSONPath gracefully', () => {
            const customHeaders = [
                { key: 'X-Missing', value: '$.user.missing' },
                { key: 'X-Static', value: 'static' }
            ];

            const headers = buildHeaders(customHeaders, mockPayload);
            
            assert.deepStrictEqual(headers, {
                'X-Missing': '', // Empty string for missing path
                'X-Static': 'static'
            });
        });

        test('should handle multiple JSONPath results', () => {
            const payloadWithArray = {
                tags: ['tag1', 'tag2', 'tag3']
            };

            const customHeaders = [
                { key: 'X-Tags', value: '$.tags' }
            ];

            const headers = buildHeaders(customHeaders, payloadWithArray);
            
            // Should join multiple values with comma
            assert.deepStrictEqual(headers, {
                'X-Tags': 'tag1,tag2,tag3'
            });
        });

        test('should skip invalid headers', () => {
            const customHeaders = [
                { key: 'Host', value: 'evil.com' }, // Unsafe header
                { key: '', value: 'empty-key' }, // Empty key
                { key: 'Valid-Header', value: 'valid' },
                { key: 'Invalid_Header!', value: 'invalid-chars' }, // Invalid chars
                { key: 'Another-Valid', value: '$.user.id' } // Valid JSONPath
            ];

            const headers = buildHeaders(customHeaders, mockPayload);
            
            // Should only include valid headers
            assert.deepStrictEqual(headers, {
                'Valid-Header': 'valid',
                'Another-Valid': '12345'
            });
        });

        test('should handle malformed header objects', () => {
            const customHeaders = [
                null,
                {},
                { key: 'Valid-Header' }, // Missing value
                { value: 'missing-key' }, // Missing key
                { key: 123, value: 456 }, // Wrong types
                { key: 'Valid-Header', value: 'valid' }
            ];

            const headers = buildHeaders(customHeaders, mockPayload);
            
            assert.deepStrictEqual(headers, {
                'Valid-Header': 'valid'
            });
        });

        test('should return empty object for non-array input', () => {
            const headers = buildHeaders(null, mockPayload);
            assert.deepStrictEqual(headers, {});
            
            const headers2 = buildHeaders({}, mockPayload);
            assert.deepStrictEqual(headers2, {});
        });

        test('should handle empty headers array', () => {
            const headers = buildHeaders([], mockPayload);
            assert.deepStrictEqual(headers, {});
        });
    });

    describe('validateHeaders', () => {
        test('should validate valid headers', () => {
            const headers = [
                { key: 'X-Custom', value: '$.user.id' }
            ];
            
            const result = validateHeaders(headers);
            assert.strictEqual(result.ok, true);
        });

        test('should reject non-array input', () => {
            const result = validateHeaders(null);
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.error, 'headers must be an array');
        });

        test('should reject missing key', () => {
            const headers = [{ value: 'value' }];
            const result = validateHeaders(headers);
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.error, 'headers[0].key must be a non-empty string');
        });

        test('should reject empty key', () => {
            const headers = [{ key: '', value: 'value' }];
            const result = validateHeaders(headers);
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.error, 'headers[0].key must be a non-empty string');
        });

        test('should reject unsafe headers', () => {
            const unsafeHeaders = ['Host', 'Content-Length', 'Content-Type', 'User-Agent', 'Authorization'];
            
            for (const header of unsafeHeaders) {
                const result = validateHeaders([{ key: header, value: 'value' }]);
                assert.strictEqual(result.ok, false);
                assert.match(result.error, /not allowed/);
            }
        });

        test('should reject invalid key characters', () => {
            const headers = [{ key: 'Invalid Header!', value: 'value' }];
            const result = validateHeaders(headers);
            assert.strictEqual(result.ok, false);
            assert.match(result.error, /invalid characters/);
        });

        test('should reject missing value', () => {
            const headers = [{ key: 'Test-Header' }];
            const result = validateHeaders(headers);
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.error, 'headers[0].value is required');
        });

        test('should reject too many headers', () => {
            const headers = Array(51).fill({ key: 'Test', value: 'value' });
            const result = validateHeaders(headers);
            assert.strictEqual(result.ok, false);
            assert.match(result.error, /too many headers/);
        });
    });
});