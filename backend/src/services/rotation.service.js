const crypto = require('crypto');
const Credential = require('../models/credential.model');
const RotationPolicy = require('../models/rotationPolicy.model');
const AuditLog = require('../models/audit.model');
const { encrypt } = require('../utils/encryption');
const logger = require('../config/logger');

/**
 * Generate a new cryptographically secure secret token.
 */
function generateSecret() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Rotate the accessToken (and optionally refreshToken) for a credential.
 * Records an audit log entry for the rotation event.
 */
async function rotateCredential(credentialId, { userId, ipAddress = '0.0.0.0', userAgent = 'system' } = {}) {
    const credential = await Credential.findById(credentialId);
    if (!credential) throw new Error(`Credential ${credentialId} not found`);

    const newAccessToken = generateSecret();
    const newRefreshToken = credential.refreshToken ? generateSecret() : undefined;

    const before = {
        accessToken: '[REDACTED]',
        refreshToken: credential.refreshToken ? '[REDACTED]' : null,
        updatedAt: credential.updatedAt,
    };

    credential.accessToken = encrypt(newAccessToken);
    if (newRefreshToken) credential.refreshToken = encrypt(newRefreshToken);
    credential.status = 'active';
    await credential.save();

    // Update policy timestamps
    await RotationPolicy.updateOne(
        { credentialId },
        { $set: { lastRotatedAt: new Date() } }
    );

    // Audit log
    await AuditLog.createLog({
        operation: 'UPDATE',
        resourceType: 'Credential',
        resourceId: credential._id,
        organization: credential.userId, // fallback; org not on credential model
        userId: userId || credential.userId,
        userAgent,
        ipAddress,
        changes: {
            before,
            after: { accessToken: '[REDACTED]', refreshToken: newRefreshToken ? '[REDACTED]' : null, updatedAt: credential.updatedAt },
            diff: [{ field: 'accessToken', oldValue: '[REDACTED]', newValue: '[REDACTED - rotated]' }],
        },
        metadata: { endpoint: '/api/credentials/:id/rotate', method: 'POST' },
    });

    logger.info('Credential rotated', { credentialId, userId });
    return { credentialId, rotatedAt: new Date() };
}

/**
 * Process all due rotation policies and rotate their credentials.
 */
async function processDueRotations() {
    const now = new Date();
    const duePolicies = await RotationPolicy.find({ enabled: true, nextRotationAt: { $lte: now } });

    const results = [];
    for (const policy of duePolicies) {
        try {
            const result = await rotateCredential(policy.credentialId, { userId: policy.userId });

            // Advance nextRotationAt
            policy.nextRotationAt = new Date(now.getTime() + policy.intervalHours * 3600 * 1000);
            policy.lastRotatedAt = now;
            await policy.save();

            results.push({ policyId: policy._id, ...result, status: 'rotated' });
        } catch (err) {
            logger.error('Auto-rotation failed', { policyId: policy._id, error: err.message });
            results.push({ policyId: policy._id, status: 'failed', error: err.message });
        }
    }
    return results;
}

module.exports = { rotateCredential, processDueRotations, generateSecret };
