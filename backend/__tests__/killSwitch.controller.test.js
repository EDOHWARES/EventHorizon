const test = require('node:test');
const assert = require('node:assert/strict');

const killSwitchService = require('../src/services/killSwitch.service');
const controller = require('../src/controllers/killSwitch.controller');

const originalGetKillSwitchStatus = killSwitchService.getKillSwitchStatus;
const originalUpdateKillSwitch = killSwitchService.updateKillSwitch;

test.after(() => {
    killSwitchService.getKillSwitchStatus = originalGetKillSwitchStatus;
    killSwitchService.updateKillSwitch = originalUpdateKillSwitch;
});

test('getKillSwitchStatus returns kill switch data', async () => {
    const fakeStatus = {
        global: false,
        perOrganization: {},
        perProvider: {},
    };

    killSwitchService.getKillSwitchStatus = async () => fakeStatus;

    let jsonPayload;
    const response = {
        json(payload) {
            jsonPayload = payload;
            return this;
        },
    };

    await controller.getKillSwitchStatus({}, response, () => {});

    assert.deepEqual(jsonPayload, fakeStatus);
});

test('getKillSwitchStatus handles errors', async () => {
    killSwitchService.getKillSwitchStatus = async () => {
        throw new Error('Database error');
    };

    let statusCode;
    let jsonPayload;
    const response = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(payload) {
            jsonPayload = payload;
            return this;
        },
    };

    await controller.getKillSwitchStatus({}, response, () => {});

    assert.equal(statusCode, 500);
    assert.deepEqual(jsonPayload, { error: 'Internal server error' });
});

test('updateKillSwitch updates kill switch', async () => {
    const fakeKillSwitch = {
        global: true,
        perOrganization: {},
        perProvider: {},
        updatedBy: 'user1',
    };

    killSwitchService.updateKillSwitch = async (updates, updatedBy) => fakeKillSwitch;

    const req = {
        body: { global: true },
        user: { id: 'user1' },
    };

    let jsonPayload;
    const response = {
        json(payload) {
            jsonPayload = payload;
            return this;
        },
    };

    await controller.updateKillSwitch(req, response, () => {});

    assert.deepEqual(jsonPayload, fakeKillSwitch);
});

test('updateKillSwitch handles errors', async () => {
    killSwitchService.updateKillSwitch = async () => {
        throw new Error('Database error');
    };

    const req = {
        body: { global: true },
        user: { id: 'user1' },
    };

    let statusCode;
    let jsonPayload;
    const response = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(payload) {
            jsonPayload = payload;
            return this;
        },
    };

    await controller.updateKillSwitch(req, response, () => {});

    assert.equal(statusCode, 500);
    assert.deepEqual(jsonPayload, { error: 'Internal server error' });
});