const test = require('node:test');
const assert = require('node:assert/strict');
const { encrypt, decrypt } = require('../src/utils/crypto');

test('Crypto Utility - encrypt and decrypt correctly', () => {
    const plainText = 'my-super-secret-password';
    const encrypted = encrypt(plainText);
    
    assert.notEqual(encrypted, plainText);
    assert.equal(typeof encrypted, 'string');
    
    const decrypted = decrypt(encrypted);
    assert.equal(decrypted, plainText);
});

test('Crypto Utility - returns null for empty inputs', () => {
    assert.equal(encrypt(''), null);
    assert.equal(decrypt(''), null);
    assert.equal(encrypt(null), null);
});

test('Crypto Utility - throws error on invalid format', () => {
    assert.throws(() => decrypt('invalid-format'), /Decryption failed|Invalid encrypted payload/);
});

test('Crypto Utility - produces different cipher texts for same input', () => {
    const plainText = 'test-data';
    const encrypted1 = encrypt(plainText);
    const encrypted2 = encrypt(plainText);
    
    assert.notEqual(encrypted1, encrypted2);
});
