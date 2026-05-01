const axios = require('axios');
const Redis = require('ioredis');
const logger = require('../config/logger');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

let redisClient = null;

try {
    redisClient = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        lazyConnect: true,
        maxRetriesPerRequest: null,
    });
    
    redisClient.on('error', (err) => {
        logger.debug('Redis error in oauth2.service', { error: err.message });
    });
} catch (error) {
    logger.warn('Failed to initialize Redis for OAuth2 service. Caching will use memory.', {
        error: error.message
    });
}

// Memory fallback if Redis fails or is disabled
const memoryCache = new Map();

const { decrypt } = require('../utils/crypto');

/**
 * Gets a valid OAuth2 access token for a trigger.
 * Utilizes caching to prevent redundant token requests.
 * @param {Object} trigger - The Trigger mongoose document or POJO
 * @returns {Promise<string|null>} - The access token or null
 */
async function getAccessToken(trigger) {
    if (trigger.authConfig?.type !== 'oauth2' || !trigger.authConfig?.oauth2) {
        return null;
    }

    const { tokenUrl, clientId } = trigger.authConfig.oauth2;
    let clientSecret;
    
    try {
        if (typeof trigger.getDecryptedClientSecret === 'function') {
            clientSecret = trigger.getDecryptedClientSecret();
        } else if (trigger.authConfig.oauth2.clientSecret) {
            clientSecret = decrypt(trigger.authConfig.oauth2.clientSecret);
        }
    } catch (e) {
        logger.error('Failed to decrypt OAuth2 client secret', { triggerId: trigger._id });
        throw new Error('Failed to decrypt OAuth2 client secret');
    }

    const triggerId = trigger._id.toString();
    const cacheKey = `oauth2:token:${triggerId}`;

    if (!clientSecret) {
        throw new Error('OAuth2 client secret is missing or could not be decrypted');
    }

    // Try cache first
    try {
        if (redisClient && redisClient.status === 'ready') {
            const cachedToken = await redisClient.get(cacheKey);
            if (cachedToken) {
                logger.debug('OAuth2 token cache hit', { triggerId });
                return cachedToken;
            }
        } else {
            const cached = memoryCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                logger.debug('OAuth2 token memory cache hit', { triggerId });
                return cached.token;
            }
        }
    } catch (error) {
        logger.warn('Error reading token from cache', { triggerId, error: error.message });
    }

    logger.info('Fetching new OAuth2 access token', { triggerId, tokenUrl });

    try {
        const response = await axios.post(tokenUrl, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { access_token, expires_in } = response.data;

        if (!access_token) {
            throw new Error('OAuth2 token response missing access_token');
        }

        // Cache the token, subtract 60 seconds as a buffer, default to 5 minutes if missing
        const ttl = (expires_in && typeof expires_in === 'number') ? Math.max(1, expires_in - 60) : 300;

        try {
            if (redisClient && redisClient.status === 'ready') {
                await redisClient.set(cacheKey, access_token, 'EX', ttl);
            } else {
                memoryCache.set(cacheKey, {
                    token: access_token,
                    expiresAt: Date.now() + (ttl * 1000)
                });
            }
        } catch (error) {
            logger.warn('Error saving token to cache', { triggerId, error: error.message });
        }

        return access_token;
    } catch (error) {
        logger.error('Failed to fetch OAuth2 token', {
            triggerId,
            error: error.response?.data || error.message
        });
        throw new Error(`Failed to fetch OAuth2 token: ${error.message}`);
    }
}

module.exports = {
    getAccessToken,
    redisClient,
    memoryCache
};
