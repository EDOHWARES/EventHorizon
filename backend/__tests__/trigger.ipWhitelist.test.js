const test = require('node:test');
const assert = require('node:assert/strict');
const Trigger = require('../src/models/trigger.model');
const triggerController = require('../src/controllers/trigger.controller');
const ipWhitelistService = require('../src/services/ipWhitelist.service');

const originalSave = Trigger.prototype.save;
const originalFindOne = Trigger.findOne;
const originalFindOneAndUpdate = Trigger.findOneAndUpdate;
const originalValidateUrl = ipWhitelistService.validateUrl;

function req(body = {}, params = {}) {
    return {
        body,
        params,
        get() {
            return 'test-agent';
        },
        ip: '127.0.0.1',
        user: {
            id: 'user-1',
            organization: { _id: 'org-1' },
        },
    };
}

function res() {
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
    };
}

test.afterEach(() => {
    Trigger.prototype.save = originalSave;
    Trigger.findOne = originalFindOne;
    Trigger.findOneAndUpdate = originalFindOneAndUpdate;
    ipWhitelistService.validateUrl = originalValidateUrl;
});

test('createTrigger validates webhook destination before saving', async () => {
    let validateInput;
    let saved = false;

    ipWhitelistService.validateUrl = async (url, organizationId, options) => {
        validateInput = { url, organizationId, options };
        return { warnings: ['DNS resolution failed: temporary'] };
    };
    Trigger.prototype.save = async function save() {
        saved = true;
        return this;
    };

    const response = res();
    await triggerController.createTrigger(req({
        contractId: 'contract-1',
        eventName: 'Event',
        actionType: 'webhook',
        actionUrl: 'https://hooks.example.com/event',
    }), response, () => {});

    assert.equal(saved, true);
    assert.deepEqual(validateInput, {
        url: 'https://hooks.example.com/event',
        organizationId: 'org-1',
        options: { allowDnsFailure: true },
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.payload.warnings, ['DNS resolution failed: temporary']);
});

test('createTrigger forwards blocked webhook destinations and does not save', async () => {
    let saved = false;
    const blocked = new ipWhitelistService.WebhookDestinationBlockedError('blocked');

    ipWhitelistService.validateUrl = async () => {
        throw blocked;
    };
    Trigger.prototype.save = async function save() {
        saved = true;
        return this;
    };

    let forwardedError;
    await triggerController.createTrigger(req({
        contractId: 'contract-1',
        eventName: 'Event',
        actionType: 'webhook',
        actionUrl: 'http://169.254.169.254/latest/meta-data',
    }), res(), (error) => {
        forwardedError = error;
    });

    assert.equal(saved, false);
    assert.equal(forwardedError, blocked);
});

test('updateTrigger validates the effective webhook destination', async () => {
    let validateInput;
    Trigger.findOne = async () => ({
        actionType: 'webhook',
        actionUrl: 'https://old.example.com/hook',
    });
    Trigger.findOneAndUpdate = async () => ({
        _id: 'trigger-1',
        actionType: 'webhook',
        actionUrl: 'https://new.example.com/hook',
    });
    ipWhitelistService.validateUrl = async (url, organizationId, options) => {
        validateInput = { url, organizationId, options };
        return { warnings: [] };
    };

    const response = res();
    await triggerController.updateTrigger(req({
        actionUrl: 'https://new.example.com/hook',
    }, { id: 'trigger-1' }), response, () => {});

    assert.deepEqual(validateInput, {
        url: 'https://new.example.com/hook',
        organizationId: 'org-1',
        options: { allowDnsFailure: true },
    });
    assert.equal(response.payload.data.actionUrl, 'https://new.example.com/hook');
});
