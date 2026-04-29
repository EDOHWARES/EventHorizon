const axios = require('axios');
const crypto = require('crypto');
const logger = require('../config/logger');
const breakers = require('./circuitBreaker');
const ipWhitelistService = require('./ipWhitelist.service');

/**
 * Webhook service for secure outbound webhook delivery with HMAC signing
 */
class WebhookService {
    /**
     * Generate HMAC signature for payload
     * @param {string} secret - The webhook secret
     * @param {string} timestamp - ISO timestamp
     * @param {object} payload - The JSON payload
     * @returns {string} - Hex-encoded HMAC signature
     */
    generateSignature(secret, timestamp, payload) {
        const payloadString = JSON.stringify(payload);
        const message = `${timestamp}.${payloadString}`;
        return crypto.createHmac('sha256', secret).update(message).digest('hex');
    }

    /**
     * Send signed webhook
     * @param {string} url - Webhook URL
     * @param {object} payload - The payload to send
     * @param {string} secret - Webhook secret for signing
     * @param {object} options - Additional options
     * @returns {Promise} - Axios response
     */
    async sendSignedWebhook(url, payload, secret, options = {}) {
        const {
            organizationId,
            organization,
            headers: optionHeaders,
            ...axiosOptions
        } = options;
        const effectiveOrganizationId = organizationId || organization;
        const destination = await ipWhitelistService.validateUrl(url, effectiveOrganizationId);
        const timestamp = new Date().toISOString();

        // Generate signature
        const signature = this.generateSignature(secret, timestamp, payload);

        // Prepare headers
        const headers = {
            'Content-Type': 'application/json',
            'X-EventHorizon-Signature': signature,
            'X-EventHorizon-Timestamp': timestamp,
            ...optionHeaders
        };

        logger.info('Sending signed webhook', {
            url,
            timestamp,
            signature: signature.substring(0, 8) + '...', // Log partial signature for debugging
            payloadKeys: Object.keys(payload)
        });

        try {
            const breakerKey = `webhook:${url}`;
            const response = await breakers.fire(
                breakerKey,
                (postUrl, postPayload, postConfig) => axios.post(postUrl, postPayload, postConfig),
                [url, payload, {
                    headers,
                    timeout: axiosOptions.timeout || 30000, // 30 second timeout
                    httpAgent: destination.agents?.httpAgent,
                    httpsAgent: destination.agents?.httpsAgent,
                    ...axiosOptions
                }],
                { timeout: axiosOptions.timeout || 30000 }
            );

            logger.info('Webhook sent successfully', {
                url,
                status: response.status,
                responseTime: response.headers['x-response-time'] || 'unknown'
            });

            return response;
        } catch (error) {
            logger.error('Webhook delivery failed', {
                url,
                error: error.message,
                status: error.response?.status,
                responseData: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Verify webhook signature (for incoming webhooks if needed)
     * @param {string} signature - Received signature
     * @param {string} timestamp - Received timestamp
     * @param {object} payload - Received payload
     * @param {string} secret - Expected secret
     * @param {number} toleranceMs - Timestamp tolerance in milliseconds (default 5 minutes)
     * @returns {boolean} - Whether signature is valid
     */
    verifySignature(signature, timestamp, payload, secret, toleranceMs = 300000) {
        // Check timestamp is within tolerance
        const now = Date.now();
        const timestampMs = new Date(timestamp).getTime();
        if (Math.abs(now - timestampMs) > toleranceMs) {
            logger.warn('Webhook timestamp outside tolerance', {
                timestamp,
                now: new Date(now).toISOString(),
                toleranceMs
            });
            return false;
        }

        // Generate expected signature
        const expectedSignature = this.generateSignature(secret, timestamp, payload);

        // Use constant-time comparison to prevent timing attacks
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    }
}

module.exports = new WebhookService();
