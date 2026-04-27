const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// We have to mock axios
const axios = require('axios');
const originalPost = axios.post;

const { getAccessToken, memoryCache, redisClient } = require('../src/services/oauth2.service');
const { encrypt } = require('../src/utils/crypto');

test.beforeEach(() => {
    memoryCache.clear();
});

test.after(async () => {
    axios.post = originalPost;
    if (redisClient) {
        await redisClient.quit();
    }
});

function getMockTrigger() {
    return {
        _id: new mongoose.Types.ObjectId(),
        authConfig: {
            type: 'oauth2',
            oauth2: {
                tokenUrl: 'https://oauth2.example.com/token',
                clientId: 'test-client',
                clientSecret: encrypt('test-secret')
            }
        }
    };
}

test('OAuth2 Service - returns null if auth type is not oauth2', async () => {
    const trigger = { authConfig: { type: 'none' } };
    const token = await getAccessToken(trigger);
    assert.equal(token, null);
});

test('OAuth2 Service - fetch and cache a new token', async () => {
    let postCallCount = 0;
    axios.post = async () => {
        postCallCount++;
        return { data: { access_token: 'new-token', expires_in: 3600 } };
    };

    const mockTrigger = getMockTrigger();
    const token = await getAccessToken(mockTrigger);
    
    assert.equal(token, 'new-token');
    assert.equal(postCallCount, 1);
    
    if (!redisClient || redisClient.status !== 'ready') {
        const cacheKey = `oauth2:token:${mockTrigger._id.toString()}`;
        assert.equal(memoryCache.has(cacheKey), true);
    }
});

test('OAuth2 Service - returns cached token on subsequent calls', async () => {
    let postCallCount = 0;
    axios.post = async () => {
        postCallCount++;
        return { data: { access_token: 'cached-token', expires_in: 3600 } };
    };

    const mockTrigger = getMockTrigger();
    await getAccessToken(mockTrigger); // fetch
    const token2 = await getAccessToken(mockTrigger); // cached
    
    assert.equal(token2, 'cached-token');
    
    if (!redisClient || redisClient.status !== 'ready') {
        assert.equal(postCallCount, 1);
    }
});

test('OAuth2 Service - throws an error if decryption fails', async () => {
    const mockTrigger = getMockTrigger();
    mockTrigger.authConfig.oauth2.clientSecret = 'invalid-encrypted-secret';
    
    await assert.rejects(
        () => getAccessToken(mockTrigger),
        /Failed to decrypt OAuth2 client secret/
    );
});

test('OAuth2 Service - handles Mongoose document triggers with getDecryptedClientSecret method', async () => {
    let getDecryptedClientSecretCalled = false;
    const mockTrigger = getMockTrigger();
    
    const docTrigger = {
        _id: mockTrigger._id,
        authConfig: mockTrigger.authConfig,
        getDecryptedClientSecret: () => {
            getDecryptedClientSecretCalled = true;
            return 'test-secret';
        }
    };

    axios.post = async () => {
        return { data: { access_token: 'doc-token', expires_in: 3600 } };
    };

    const token = await getAccessToken(docTrigger);
    assert.equal(token, 'doc-token');
    assert.equal(getDecryptedClientSecretCalled, true);
});
