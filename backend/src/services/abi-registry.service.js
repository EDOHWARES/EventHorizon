const axios = require('axios');
const logger = require('../config/logger');

/**
 * ABI Registry Service
 * 
 * Provides high-throughput metadata fetching and management for Soroban contract ABIs.
 * Interacts with the on-chain ABI Registry contract for:
 * - Contract registration with ABI metadata
 * - ABI version management and updates
 * - Contract verification
 * - Automatic discovery via name lookup
 */
class AbiRegistryService {
    constructor(sorobanRpcUrl, contractAddress) {
        this.sorobanRpcUrl = sorobanRpcUrl;
        this.contractAddress = contractAddress;
        this.client = axios.create({
            baseURL: sorobanRpcUrl,
            timeout: 30000
        });
        
        // Cache for frequently accessed ABIs (in-memory LRU-like cache)
        this.abiCache = new Map();
        this.maxCacheSize = 100;
    }

    /**
     * Register a new contract with ABI metadata
     * @param {string} contractId - The Soroban contract address
     * @param {string} name - Contract name
     * @param {string} description - Contract description
     * @param {Buffer|Uint8Array} abiData - The ABI/IDL data
     * @param {string} note - Version note
     * @returns {Promise<number>} - The version number
     */
    async registerContract(contractId, name, description, abiData, note) {
        try {
            // Convert ABI data to base64 if needed
            const abiBase64 = Buffer.isBuffer(abiData) 
                ? abiData.toString('base64')
                : Buffer.from(abiData).toString('base64');

            const result = await this._invokeContract('register', {
                contract_id: contractId,
                name,
                description,
                abi_data: Array.from(abiData),
                note
            });

            logger.info('Contract registered in ABI registry', {
                contractId,
                name,
                version: result
            });

            // Update cache
            this._cacheAbi(contractId, abiData);

            return result;
        } catch (error) {
            logger.error('Failed to register contract', {
                contractId,
                name,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Update ABI for an existing contract
     * @param {string} contractId - The Soroban contract address
     * @param {Buffer|Uint8Array} abiData - The new ABI/IDL data
     * @param {string} note - Version note describing changes
     * @returns {Promise<number>} - The new version number
     */
    async updateAbi(contractId, abiData, note) {
        try {
            const result = await this._invokeContract('update', {
                contract_id: contractId,
                abi_data: Array.from(abiData),
                note
            });

            logger.info('Contract ABI updated', {
                contractId,
                version: result
            });

            // Update cache
            this._cacheAbi(contractId, abiData);

            return result;
        } catch (error) {
            logger.error('Failed to update contract ABI', {
                contractId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Mark a contract as verified
     * @param {string} contractId - The Soroban contract address
     * @returns {Promise<boolean>} - Verification success
     */
    async verifyContract(contractId) {
        try {
            const result = await this._invokeContract('verify', {
                contract_id: contractId
            });

            logger.info('Contract verified', { contractId });
            return result;
        } catch (error) {
            logger.error('Failed to verify contract', {
                contractId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Remove a contract from the registry
     * @param {string} contractId - The Soroban contract address
     * @returns {Promise<boolean>} - Removal success
     */
    async removeContract(contractId) {
        try {
            const result = await this._invokeContract('remove', {
                contract_id: contractId
            });

            // Clear from cache
            this.abiCache.delete(contractId);

            logger.info('Contract removed from ABI registry', { contractId });
            return result;
        } catch (error) {
            logger.error('Failed to remove contract', {
                contractId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get contract metadata (without full ABI for efficiency)
     * Optimized for high-throughput metadata fetching
     * @param {string} contractId - The Soroban contract address
     * @returns {Promise<object>} - Contract metadata
     */
    async getMetadata(contractId) {
        // Check cache first
        const cached = this.abiCache.get(contractId);
        if (cached?.metadata) {
            return cached.metadata;
        }

        try {
            const result = await this._invokeContract('get_metadata', {
                contract_id: contractId
            });

            // Cache metadata
            const metadata = {
                contractId: result.contract_id,
                name: result.name,
                description: result.description,
                version: result.version,
                verified: result.verified,
                addedAt: result.added_at,
                updatedAt: result.updated_at
            };

            this._updateCacheEntry(contractId, { metadata });
            return metadata;
        } catch (error) {
            logger.error('Failed to get contract metadata', {
                contractId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get ABI data for a contract
     * Optimized for high-throughput metadata fetching
     * @param {string} contractId - The Soroban contract address
     * @returns {Promise<Buffer>} - The ABI data
     */
    async getAbi(contractId) {
        // Check cache first
        const cached = this.abiCache.get(contractId);
        if (cached?.abi) {
            return cached.abi;
        }

        try {
            const result = await this._invokeContract('get_abi', {
                contract_id: contractId
            });

            const abiData = Buffer.from(result);

            // Cache the ABI
            this._cacheAbi(contractId, abiData);

            return abiData;
        } catch (error) {
            logger.error('Failed to get contract ABI', {
                contractId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get version history for a contract
     * @param {string} contractId - The Soroban contract address
     * @returns {Promise<Array>} - Version history array
     */
    async getVersionHistory(contractId) {
        try {
            const result = await this._invokeContract('get_version_history', {
                contract_id: contractId
            });

            return result.map(v => ({
                version: v.version,
                abiHash: Buffer.from(v.abi_hash).toString('hex'),
                createdAt: v.created_at,
                note: v.note
            }));
        } catch (error) {
            logger.error('Failed to get version history', {
                contractId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Lookup contract by name (for automatic discovery)
     * @param {string} name - Contract name
     * @returns {Promise<string|null>} - Contract address or null
     */
    async getByName(name) {
        try {
            const result = await this._invokeContract('get_by_name', {
                name
            });

            return result || null;
        } catch (error) {
            logger.error('Failed to lookup contract by name', {
                name,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get all verified contracts
     * @returns {Promise<Array<string>>} - Array of verified contract addresses
     */
    async getVerifiedContracts() {
        try {
            const result = await this._invokeContract('get_verified_contracts', {});
            return result;
        } catch (error) {
            logger.error('Failed to get verified contracts', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Check if a contract is registered
     * @param {string} contractId - The Soroban contract address
     * @returns {Promise<boolean>} - Registration status
     */
    async isRegistered(contractId) {
        try {
            const result = await this._invokeContract('is_registered', {
                contract_id: contractId
            });
            return result;
        } catch (error) {
            // Contract not found returns false, not an error
            if (error.message?.includes('not registered')) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Rollback to a previous ABI version
     * @param {string} contractId - The Soroban contract address
     * @param {number} targetVersion - Target version to rollback to
     * @returns {Promise<boolean>} - Rollback success
     */
    async rollback(contractId, targetVersion) {
        try {
            const result = await this._invokeContract('rollback', {
                contract_id: contractId,
                target_version: targetVersion
            });

            logger.info('Contract ABI rolled back', {
                contractId,
                targetVersion
            });

            return result;
        } catch (error) {
            logger.error('Failed to rollback contract ABI', {
                contractId,
                targetVersion,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Subscribe to ABI update events (for event-driven workflows)
     * Uses Soroban event streaming
     * @param {Function} callback - Callback for ABI events
     * @returns {Function} - Unsubscribe function
     */
    subscribeToAbiEvents(callback) {
        // This would integrate with the worker's event polling
        // For now, return a placeholder
        logger.info('ABI event subscription initialized');
        
        return () => {
            logger.info('ABI event subscription closed');
        };
    }

    /**
     * Invoke a contract method via Soroban RPC
     * @private
     */
    async _invokeContract(method, params) {
        try {
            // Build the contract invocation request
            const request = {
                jsonrpc: '2.0',
                id: Date.now().toString(),
                method: 'invoke',
                params: {
                    contractId: this.contractAddress,
                    method: method,
                    args: this._encodeParams(params)
                }
            };

            const response = await this.client.post('', request);

            if (response.data.error) {
                throw new Error(response.data.error.message || 'Contract invocation failed');
            }

            return response.data.result;
        } catch (error) {
            // Handle "contract not registered" as a specific case
            if (error.message?.includes('Contract not registered')) {
                throw error;
            }
            throw error;
        }
    }

    /**
     * Encode parameters for contract invocation
     * @private
     */
    _encodeParams(params) {
        // Convert params to Soroban XDR format
        // This is a simplified version - actual implementation would use
        // the @stellar/stellar-sdk XDR encoding
        return params;
    }

    /**
     * Cache ABI data for fast retrieval
     * @private
     */
    _cacheAbi(contractId, abiData) {
        // Implement LRU-like cache
        if (this.abiCache.size >= this.maxCacheSize) {
            // Remove oldest entry
            const firstKey = this.abiCache.keys().next().value;
            this.abiCache.delete(firstKey);
        }

        this.abiCache.set(contractId, {
            abi: abiData,
            timestamp: Date.now()
        });
    }

    /**
     * Update cache entry with metadata
     * @private
     */
    _updateCacheEntry(contractId, data) {
        const existing = this.abiCache.get(contractId) || {};
        this.abiCache.set(contractId, {
            ...existing,
            ...data,
            timestamp: Date.now()
        });
    }

    /**
     * Clear the ABI cache
     */
    clearCache() {
        this.abiCache.clear();
        logger.info('ABI cache cleared');
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        return {
            size: this.abiCache.size,
            maxSize: this.maxCacheSize,
            entries: Array.from(this.abiCache.keys())
        };
    }
}

module.exports = AbiRegistryService;