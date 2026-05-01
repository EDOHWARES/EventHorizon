const axios = require('axios');
const Credential = require('../models/credential.model');
const { encrypt, decrypt } = require('../utils/encryption');
const logger = require('../config/logger');
const breakers = require('./circuitBreaker');

// Configuration for supported providers
const PROVIDERS = {
    slack: {
        clientId: process.env.SLACK_CLIENT_ID,
        clientSecret: process.env.SLACK_CLIENT_SECRET,
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
    },
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        tokenUrl: 'https://oauth2.googleapis.com/token',
    }
};

/**
 * Refreshes an OAuth token if a refresh token is available.
 */
async function refreshAccessToken(credential) {
    const config = PROVIDERS[credential.provider];
    if (!config || !credential.refreshToken) {
        credential.status = 'expired';
        await credential.save();
        throw new Error(`Cannot refresh token for ${credential.provider}: Missing configuration or refresh token.`);
    }

    try {
        const plainRefreshToken = decrypt(credential.refreshToken);
        
        const response = await breakers.fire(
            `oauth:${credential.provider}`,
            (tokenUrl, body, cfg) => axios.post(tokenUrl, body, cfg),
            [
                config.tokenUrl,
                new URLSearchParams({
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: plainRefreshToken
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            ]
        );

        const { access_token, refresh_token, expires_in } = response.data;
        
        credential.accessToken = encrypt(access_token);
        if (refresh_token) {
            credential.refreshToken = encrypt(refresh_token);
        }
        if (expires_in) {
            credential.expiresAt = new Date(Date.now() + expires_in * 1000);
        }
        
        credential.status = 'active';
        await credential.save();
        
        return access_token;
    } catch (error) {
        logger.error(`Failed to refresh token for ${credential.provider}`, { 
            error: error.message, 
            userId: credential.userId 
        });
        
        // Handle completely revoked/invalidated tokens gracefully
        if (error.response && [400, 401].includes(error.response.status)) {
            credential.status = 'revoked';
            await credential.save();
        }
        throw new Error(`Authentication expired for ${credential.provider}. Please reconnect your account.`);
    }
}

/**
 * Fetches a valid access token for action processing. 
 * Auto-refreshes if within 5 minutes of expiration.
 */
async function getValidToken(userId, provider) {
    const credential = await Credential.findOne({ userId, provider, status: 'active' });
    
    if (!credential) {
        throw new Error(`No active ${provider} connection found for this user.`);
    }

    // If token expires within the next 5 minutes (300000 ms), refresh it proactively
    if (credential.expiresAt && (credential.expiresAt.getTime() - Date.now() < 300000)) {
        logger.info(`Proactively refreshing token for ${provider}`, { userId });
        return await refreshAccessToken(credential);
    }

    return decrypt(credential.accessToken);
}

/**
 * Mark a credential as revoked manually (e.g., user removes integration).
 */
async function revokeCredential(userId, provider) {
    await Credential.findOneAndUpdate(
        { userId, provider }, 
        { $set: { status: 'revoked' } }
    );
}

module.exports = { getValidToken, refreshAccessToken, revokeCredential, PROVIDERS };