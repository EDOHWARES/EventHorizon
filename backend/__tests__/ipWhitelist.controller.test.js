const test = require('node:test');
const assert = require('node:assert/strict');
const IpWhitelist = require('../src/models/ipWhitelist.model');
const ipWhitelistService = require('../src/services/ipWhitelist.service');
const controller = require('../src/controllers/ipWhitelist.controller');

const originalFind = IpWhitelist.find;
const originalFindOneAndUpdate = IpWhitelist.findOneAndUpdate;
const originalFindOneAndDelete = IpWhitelist.findOneAndDelete;
const originalCreateEntry = ipWhitelistService.createEntry;
const originalNormalizeCidr = ipWhitelistService.normalizeCidr;

function responseRecorder() {
    return {
        statusCode: 200,
        payload: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
        send() {
            this.sent = true;
            return this;
        },
    };
}

function request(body = {}, params = {}) {
    return {
        body,
        params,
        user: {
            id: 'user-1',
            organization: { _id: 'org-1' },
        },
    };
}

test.afterEach(() => {
    IpWhitelist.find = originalFind;
    IpWhitelist.findOneAndUpdate = originalFindOneAndUpdate;
    IpWhitelist.findOneAndDelete = originalFindOneAndDelete;
    ipWhitelistService.createEntry = originalCreateEntry;
    ipWhitelistService.normalizeCidr = originalNormalizeCidr;
});

test('listEntries scopes results to the current organization', async () => {
    let query;
    IpWhitelist.find = (receivedQuery) => {
        query = receivedQuery;
        return {
            sort: async () => [{ cidr: '203.0.113.0/24' }],
        };
    };

    const res = responseRecorder();
    await controller.listEntries(request(), res, () => {});

    assert.deepEqual(query, { organization: 'org-1' });
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data[0].cidr, '203.0.113.0/24');
});

test('createEntry uses the current organization and user', async () => {
    let input;
    ipWhitelistService.createEntry = async (receivedInput) => {
        input = receivedInput;
        return { _id: 'entry-1', cidr: '203.0.113.0/24' };
    };

    const res = responseRecorder();
    await controller.createEntry(request({
        cidr: '203.0.113.0/24',
        label: 'partner',
        enabled: true,
    }), res, () => {});

    assert.deepEqual(input, {
        organizationId: 'org-1',
        cidr: '203.0.113.0/24',
        label: 'partner',
        enabled: true,
        addedBy: 'user-1',
    });
    assert.equal(res.statusCode, 201);
});

test('updateEntry scopes updates and normalizes CIDR', async () => {
    let query;
    let updates;
    ipWhitelistService.normalizeCidr = () => '203.0.113.0/24';
    IpWhitelist.findOneAndUpdate = async (receivedQuery, receivedUpdates) => {
        query = receivedQuery;
        updates = receivedUpdates;
        return { _id: 'entry-1', ...updates };
    };

    const res = responseRecorder();
    await controller.updateEntry(request({
        cidr: '203.0.113.1',
        enabled: false,
    }, { id: 'entry-1' }), res, () => {});

    assert.deepEqual(query, { _id: 'entry-1', organization: 'org-1' });
    assert.deepEqual(updates, { cidr: '203.0.113.0/24', enabled: false });
    assert.equal(res.payload.success, true);
});

test('deleteEntry scopes deletion to the current organization', async () => {
    let query;
    IpWhitelist.findOneAndDelete = async (receivedQuery) => {
        query = receivedQuery;
        return { _id: 'entry-1' };
    };

    const res = responseRecorder();
    await controller.deleteEntry(request({}, { id: 'entry-1' }), res, () => {});

    assert.deepEqual(query, { _id: 'entry-1', organization: 'org-1' });
    assert.equal(res.statusCode, 204);
});
