const test = require('node:test');
const assert = require('node:assert/strict');

const Trigger = require('../src/models/trigger.model');
const controller = require('../src/controllers/trigger.controller');
const AppError = require('../src/utils/appError');

const originalFind = Trigger.find;
const originalFindByIdAndDelete = Trigger.findByIdAndDelete;

test.after(() => {
    Trigger.find = originalFind;
    Trigger.findByIdAndDelete = originalFindByIdAndDelete;
});

test('getTriggers returns wrapped success payload', async () => {
    const fakeTriggers = [{ contractId: 'abc' }];
    Trigger.find = async () => fakeTriggers;

    let jsonPayload;
    const response = {
        json(payload) {
            jsonPayload = payload;
            return this;
        },
    };

    await controller.getTriggers({}, response, () => {});

    assert.deepEqual(jsonPayload, {
        success: true,
        data: fakeTriggers,
    });
});

test('deleteTrigger forwards AppError when trigger is missing', async () => {
    Trigger.findByIdAndDelete = async () => null;

    let forwardedError;

    await controller.deleteTrigger(
        { params: { id: 'missing-id' } },
        {
            status() {
                return this;
            },
            send() {
                return this;
            },
        },
        (error) => {
            forwardedError = error;
        }
    );

    assert.ok(forwardedError instanceof AppError);
    assert.equal(forwardedError.statusCode, 404);
    assert.equal(forwardedError.message, 'Trigger not found');
});

test('createTrigger with authConfig succeeds', async () => {
    const originalSave = Trigger.prototype.save;
    Trigger.prototype.save = async function() { return this; };

    const req = {
        body: {
            contractId: 'abc',
            eventName: 'evt',
            actionUrl: 'http://example.com',
            authConfig: {
                type: 'oauth2',
                oauth2: {
                    tokenUrl: 'http://token',
                    clientId: 'client',
                    clientSecret: 'secret'
                }
            }
        },
        get() { return 'Test Agent'; },
        ip: '127.0.0.1'
    };

    let jsonPayload;
    let statusVal;
    const res = {
        status(s) { statusVal = s; return this; },
        json(payload) { jsonPayload = payload; return this; }
    };

    try {
        await controller.createTrigger(req, res, () => {});

        assert.equal(statusVal, 201);
        assert.equal(jsonPayload.success, true);
        assert.equal(jsonPayload.data.authConfig.type, 'oauth2');
    } finally {
        Trigger.prototype.save = originalSave;
    }
});
