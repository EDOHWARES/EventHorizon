const AbiRegistryService = require('../src/services/abi-registry.service');
const { test, describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('AbiRegistryService', () => {
    let service;
    const mockSorobanRpcUrl = 'https://soroban-testnet.stellar.org';
    const mockContractAddress = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

    beforeEach(() => {
        service = new AbiRegistryService(mockSorobanRpcUrl, mockContractAddress);
    });

    describe('constructor', () => {
        test('should initialize with correct configuration', () => {
            assert.strictEqual(service.sorobanRpcUrl, mockSorobanRpcUrl);
            assert.strictEqual(service.contractAddress, mockContractAddress);
            assert.ok(service.client);
            assert.ok(service.abiCache);
            assert.strictEqual(service.maxCacheSize, 100);
        });

        test('should initialize empty cache', () => {
            assert.strictEqual(service.abiCache.size, 0);
        });
    });

    describe('registerContract', () => {
        test('should register contract with valid parameters', async () => {
            // Mock the _invokeContract method
            const mockInvoke = async (method, params) => {
                if (method === 'register') {
                    return 1; // version 1
                }
                return null;
            };
            
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const name = 'TestContract';
            const description = 'A test contract for validation';
            const abiData = Buffer.from([1, 2, 3, 4, 5]);
            const note = 'Initial version';

            const version = await service.registerContract(contractId, name, description, abiData, note);

            assert.strictEqual(version, 1);
        });

        test('should cache ABI after registration', async () => {
            const mockInvoke = async (method, params) => 1;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const abiData = Buffer.from([1, 2, 3, 4, 5]);

            await service.registerContract(
                contractId,
                'TestContract',
                'Description',
                abiData,
                'Note'
            );

            const cached = service.abiCache.get(contractId);
            assert.ok(cached);
            assert.ok(cached.abi);
        });
    });

    describe('updateAbi', () => {
        test('should update ABI and return new version', async () => {
            const mockInvoke = async (method, params) => 2;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const abiData = Buffer.from([1, 2, 3, 4, 5, 6]);
            const note = 'Added new function';

            const version = await service.updateAbi(contractId, abiData, note);

            assert.strictEqual(version, 2);
        });

        test('should update cache on ABI update', async () => {
            const mockInvoke = async (method, params) => 2;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const abiData = Buffer.from([1, 2, 3, 4, 5, 6]);

            await service.updateAbi(contractId, abiData, 'Update note');

            const cached = service.abiCache.get(contractId);
            assert.ok(cached);
        });
    });

    describe('getMetadata', () => {
        test('should return cached metadata if available', async () => {
            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const cachedMetadata = {
                contractId,
                name: 'CachedContract',
                version: 1,
                verified: false
            };

            service.abiCache.set(contractId, { metadata: cachedMetadata });

            const metadata = await service.getMetadata(contractId);

            assert.strictEqual(metadata.name, 'CachedContract');
        });

        test('should fetch metadata from contract if not cached', async () => {
            const mockInvoke = async (method, params) => ({
                contract_id: params.contract_id,
                name: 'FetchedContract',
                description: 'Description',
                version: 1,
                verified: false,
                added_at: 1234567890,
                updated_at: 1234567890
            });
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

            const metadata = await service.getMetadata(contractId);

            assert.strictEqual(metadata.name, 'FetchedContract');
            assert.strictEqual(metadata.contractId, contractId);
        });
    });

    describe('getAbi', () => {
        test('should return cached ABI if available', async () => {
            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const cachedAbi = Buffer.from([1, 2, 3, 4, 5]);

            service.abiCache.set(contractId, { abi: cachedAbi });

            const abi = await service.getAbi(contractId);

            assert.deepStrictEqual(abi, cachedAbi);
        });

        test('should fetch ABI from contract if not cached', async () => {
            const mockInvoke = async (method, params) => [1, 2, 3, 4, 5];
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

            const abi = await service.getAbi(contractId);

            assert.ok(abi);
            assert.ok(abi.length > 0);
        });
    });

    describe('getByName', () => {
        test('should return contract address for valid name', async () => {
            const expectedAddress = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const mockInvoke = async (method, params) => expectedAddress;
            service._invokeContract = mockInvoke;

            const result = await service.getByName('MyContract');

            assert.strictEqual(result, expectedAddress);
        });

        test('should return null for non-existent name', async () => {
            const mockInvoke = async (method, params) => null;
            service._invokeContract = mockInvoke;

            const result = await service.getByName('NonExistent');

            assert.strictEqual(result, null);
        });
    });

    describe('isRegistered', () => {
        test('should return true for registered contract', async () => {
            const mockInvoke = async (method, params) => true;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

            const result = await service.isRegistered(contractId);

            assert.strictEqual(result, true);
        });

        test('should return false for unregistered contract', async () => {
            const mockInvoke = async (method, params) => {
                throw new Error('Contract not registered');
            };

            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

            const result = await service.isRegistered(contractId);

            assert.strictEqual(result, false);
        });
    });

    describe('verifyContract', () => {
        test('should verify contract successfully', async () => {
            const mockInvoke = async (method, params) => true;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

            const result = await service.verifyContract(contractId);

            assert.strictEqual(result, true);
        });
    });

    describe('removeContract', () => {
        test('should remove contract and clear cache', async () => {
            const mockInvoke = async (method, params) => true;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            
            // Add to cache first
            service.abiCache.set(contractId, { abi: Buffer.from([1, 2, 3]) });

            const result = await service.removeContract(contractId);

            assert.strictEqual(result, true);
            assert.strictEqual(service.abiCache.has(contractId), false);
        });
    });

    describe('cache management', () => {
        test('clearCache should empty the cache', () => {
            service.abiCache.set('contract1', { abi: Buffer.from([1]) });
            service.abiCache.set('contract2', { abi: Buffer.from([2]) });

            service.clearCache();

            assert.strictEqual(service.abiCache.size, 0);
        });

        test('getCacheStats should return correct stats', () => {
            service.abiCache.set('contract1', { abi: Buffer.from([1]) });
            service.abiCache.set('contract2', { abi: Buffer.from([2]) });

            const stats = service.getCacheStats();

            assert.strictEqual(stats.size, 2);
            assert.strictEqual(stats.maxSize, 100);
            assert.strictEqual(stats.entries.length, 2);
        });

        test('cache should implement LRU-like behavior', async () => {
            const mockInvoke = async (method, params) => {
                if (method === 'get_abi') return [1, 2, 3];
                return { contract_id: params.contract_id, name: 'Test', description: 'Desc', version: 1, verified: false, added_at: 123, updated_at: 123 };
            };
            service._invokeContract = mockInvoke;

            // Fill cache beyond max size
            for (let i = 0; i < 101; i++) {
                const contractId = `contract${i}`;
                await service.getAbi(contractId);
            }

            // Cache should not exceed max size
            assert.ok(service.abiCache.size <= service.maxCacheSize);
        });
    });

    describe('getVersionHistory', () => {
        test('should return formatted version history', async () => {
            const mockInvoke = async (method, params) => [
                { version: 1, abi_hash: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], created_at: 1234567890, note: 'v1' },
                { version: 2, abi_hash: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], created_at: 1234567900, note: 'v2' }
            ];
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';
            const history = await service.getVersionHistory(contractId);

            assert.strictEqual(history.length, 2);
            assert.strictEqual(history[0].version, 1);
            assert.strictEqual(history[1].version, 2);
            assert.ok(history[0].abiHash);
        });
    });

    describe('getVerifiedContracts', () => {
        test('should return list of verified contracts', async () => {
            const mockInvoke = async (method, params) => [
                'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0',
                'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z1'
            ];
            service._invokeContract = mockInvoke;

            const contracts = await service.getVerifiedContracts();

            assert.strictEqual(contracts.length, 2);
        });
    });

    describe('rollback', () => {
        test('should rollback to target version', async () => {
            const mockInvoke = async (method, params) => true;
            service._invokeContract = mockInvoke;

            const contractId = 'CBQ2J3F7CN5MWJ4R3TJZ5O6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z0';

            const result = await service.rollback(contractId, 1);

            assert.strictEqual(result, true);
        });
    });

    describe('subscribeToAbiEvents', () => {
        test('should return unsubscribe function', () => {
            const callback = () => {};
            const unsubscribe = service.subscribeToAbiEvents(callback);

            assert.strictEqual(typeof unsubscribe, 'function');
        });
    });
});