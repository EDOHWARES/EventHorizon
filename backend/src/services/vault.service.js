const vault = require('node-vault');
const logger = require('../config/logger');

class VaultService {
    constructor() {
        this.client = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        const vaultAddr = process.env.VAULT_ADDR || 'http://localhost:8200';
        const vaultToken = process.env.VAULT_TOKEN;

        if (!vaultToken) {
            logger.warn('VAULT_TOKEN not set, falling back to local secrets');
            this.initialized = true;
            return;
        }

        try {
            this.client = vault({
                apiVersion: 'v1',
                endpoint: vaultAddr,
                token: vaultToken,
            });

            // Test connection
            await this.client.health();
            logger.info('Vault connection established');
            this.initialized = true;
        } catch (error) {
            logger.error('Failed to initialize Vault client', { error: error.message });
            throw error;
        }
    }

    async getSecret(path, key) {
        if (!this.client) {
            // Fallback to environment variables
            const envKey = key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            const value = process.env[envKey];
            if (!value) {
                throw new Error(`Secret ${key} not found in Vault or environment`);
            }
            logger.debug(`Using fallback env var for ${key}`);
            return value;
        }

        try {
            const result = await this.client.read(path);
            return result.data[key];
        } catch (error) {
            logger.error(`Failed to retrieve secret ${path}:${key}`, { error: error.message });
            throw error;
        }
    }

    async getWebhookSecret(webhookId) {
        return this.getSecret(`secret/webhooks/${webhookId}`, 'secret');
    }

    async getApiKey(service) {
        return this.getSecret(`secret/api/${service}`, 'key');
    }

    async rotateSecret(path, key, newValue) {
        if (!this.client) {
            logger.warn('Vault not available, cannot rotate secret');
            return;
        }

        try {
            await this.client.write(path, { [key]: newValue });
            logger.info(`Secret rotated: ${path}:${key}`);
        } catch (error) {
            logger.error(`Failed to rotate secret ${path}:${key}`, { error: error.message });
            throw error;
        }
    }
}

module.exports = new VaultService();