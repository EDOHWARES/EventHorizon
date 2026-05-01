const test = require('node:test');
const assert = require('node:assert/strict');
const { validationSchemas } = require('../src/middleware/validation.middleware');
const Trigger = require('../src/models/trigger.model');
const triggerController = require('../src/controllers/trigger.controller');
const ipWhitelistService = require('../src/services/ipWhitelist.service');

const originalSave = Trigger.prototype.save;
const originalValidateUrl = ipWhitelistService.validateUrl;

function req(body = {}) {
    return {
        body,
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
    ipWhitelistService.validateUrl = originalValidateUrl;
});

test('trigger create validation accepts workflow steps without top-level actionUrl', () => {
    const { error, value } = validationSchemas.triggerCreate.validate({
        contractId: 'contract-1',
        eventName: 'Transfer',
        steps: [
            { id: 'notifyWebhook', actionType: 'webhook', actionUrl: 'https://example.com/hook' },
            { id: 'notifyTelegram', actionType: 'telegram', actionUrl: 'chat-1' },
        ],
    });

    assert.equal(error, undefined);
    assert.equal(value.steps.length, 2);
});

test('trigger create validation rejects workflow with top-level actionUrl', () => {
    const { error } = validationSchemas.triggerCreate.validate({
        contractId: 'contract-1',
        eventName: 'Transfer',
        actionUrl: 'https://example.com/top-level',
        steps: [
            { id: 'notifyWebhook', actionType: 'webhook', actionUrl: 'https://example.com/hook' },
        ],
    });

    assert.match(error.message, /cannot also define top-level actionUrl/);
});

test('trigger update validation rejects workflow with top-level actionUrl', () => {
    const { error } = validationSchemas.triggerUpdate.validate({
        actionUrl: 'https://example.com/top-level',
        steps: [
            { id: 'notifyWebhook', actionType: 'webhook', actionUrl: 'https://example.com/hook' },
        ],
    });

    assert.match(error.message, /cannot also define top-level actionUrl/);
});

test('trigger create validation rejects duplicate step ids', () => {
    const { error } = validationSchemas.triggerCreate.validate({
        contractId: 'contract-1',
        eventName: 'Transfer',
        steps: [
            { id: 'notify', actionType: 'webhook', actionUrl: 'https://example.com/one' },
            { id: 'notify', actionType: 'webhook', actionUrl: 'https://example.com/two' },
        ],
    });

    assert.match(error.message, /Workflow step ids must be unique/);
});

test('createTrigger validates webhook URLs inside workflow steps', async () => {
    const validated = [];

    ipWhitelistService.validateUrl = async (url, organizationId, options) => {
        validated.push({ url, organizationId, options });
        return { warnings: [`warning for ${url}`] };
    };
    Trigger.prototype.save = async function save() {
        return this;
    };

    const response = res();
    await triggerController.createTrigger(req({
        contractId: 'contract-1',
        eventName: 'Transfer',
        steps: [
            { id: 'firstHook', actionType: 'webhook', actionUrl: 'https://example.com/one' },
            { id: 'sendMessage', actionType: 'telegram', actionUrl: 'chat-1' },
            { id: 'secondHook', actionType: 'webhook', actionUrl: 'https://example.com/two' },
        ],
    }), response, () => {});

    assert.deepEqual(validated, [
        {
            url: 'https://example.com/one',
            organizationId: 'org-1',
            options: { allowDnsFailure: true },
        },
        {
            url: 'https://example.com/two',
            organizationId: 'org-1',
            options: { allowDnsFailure: true },
        },
    ]);
    assert.deepEqual(response.payload.warnings, [
        'step firstHook: warning for https://example.com/one',
        'step secondHook: warning for https://example.com/two',
    ]);
});
