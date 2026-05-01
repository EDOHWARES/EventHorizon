const crypto = require('crypto');
const logger = require('../config/logger');

// Retrieve encryption key from environment, fallback to a deterministic key for development only
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// The key must be a 32-byte Buffer for aes-256-gcm
let ENCRYPTION_KEY;
try {
    ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_STRING, 'hex');
    if (ENCRYPTION_KEY.length !== 32) {
        throw new Error('Invalid key length. Must be 32 bytes.');
    }
} catch (error) {
    logger.error('Failed to initialize ENCRYPTION_KEY. It must be a valid 64-character hex string (32 bytes).', {
        error: error.message
    });
    // Fallback just to ensure app doesn't crash on startup if misconfigured, but warn loudly
    ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_KEY_STRING, 'salt', 32);
}

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts a plain text string using aes-256-gcm
 * @param {string} text - The plain text to encrypt
 * @returns {string|null} - The encrypted payload in the format iv:authTag:encryptedText, or null if text is empty
 */
function encrypt(text) {
    if (!text) return null;

    try {
        const iv = crypto.randomBytes(12); // 96-bit IV for GCM
        const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');

        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (error) {
        logger.error('Encryption failed', { error: error.message });
        throw new Error('Encryption failed');
    }
}

/**
 * Decrypts an encrypted payload using aes-256-gcm
 * @param {string} encryptedPayload - The encrypted payload in the format iv:authTag:encryptedText
 * @returns {string|null} - The decrypted plain text, or null if payload is empty
 */
function decrypt(encryptedPayload) {
    if (!encryptedPayload) return null;

    try {
        const parts = encryptedPayload.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted payload format');
        }

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        logger.error('Decryption failed', { error: error.message });
        throw new Error('Decryption failed');
    }
}

module.exports = {
    encrypt,
    decrypt,
};
