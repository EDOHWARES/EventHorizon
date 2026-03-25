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
