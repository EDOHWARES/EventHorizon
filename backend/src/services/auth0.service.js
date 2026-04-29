const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger = require('../config/logger');

/**
 * Service for Auth0 Authentication and Management
 */
class Auth0Service {
    constructor() {
        this.domain = process.env.AUTH0_DOMAIN;
        this.clientId = process.env.AUTH0_CLIENT_ID;
        this.jwksUri = `https://${this.domain}/.well-known/jwks.json`;
        
        this.client = jwksClient({
            jwksUri: this.jwksUri,
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5
        });
    }

    /**
     * Get the signing key for a given token header
     * @param {object} header - JWT header
     * @returns {Promise<string>} - Public key
     */
    async getSigningKey(header) {
        return new Promise((resolve, reject) => {
            this.client.getSigningKey(header.kid, (err, key) => {
                if (err) return reject(err);
                const signingKey = key.getPublicKey();
                resolve(signingKey);
            });
        });
    }

    /**
     * Verify an Auth0 ID Token
     * @param {string} token - The JWT token to verify
     * @returns {Promise<object>} - Decoded payload
     */
    async verifyToken(token) {
        const decodedToken = jwt.decode(token, { complete: true });
        if (!decodedToken) {
            throw new Error('Invalid token format');
        }

        const signingKey = await this.getSigningKey(decodedToken.header);
        
        return new Promise((resolve, reject) => {
            jwt.verify(token, signingKey, {
                audience: this.clientId,
                issuer: `https://${this.domain}/`,
                algorithms: ['RS256']
            }, (err, decoded) => {
                if (err) {
                    logger.error('Auth0 token verification failed', { error: err.message });
                    return reject(err);
                }
                resolve(decoded);
            });
        });
    }

    /**
     * Map Auth0 roles/groups to EventHorizon roles
     * @param {string[]} auth0Roles - Array of roles from Auth0 claim
     * @returns {string} - Mapped internal role name
     */
    mapRoles(auth0Roles) {
        if (!auth0Roles || !Array.isArray(auth0Roles)) {
            return 'Member'; // Default role
        }

        // Example mapping logic - can be moved to environment variables
        if (auth0Roles.includes('eh_admin')) return 'Owner';
        if (auth0Roles.includes('eh_editor')) return 'Member';
        
        return 'Member';
    }
}

module.exports = new Auth0Service();
