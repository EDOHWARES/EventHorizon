const test = require('node:test');
const assert = require('node:assert/strict');

const KillSwitch = require('../src/models/killSwitch.model');
const killSwitchService = require('../src/services/killSwitch.service');

const originalFindOne = KillSwitch.findOne;
const originalFindOneAndUpdate = KillSwitch.findOneAndUpdate;

test.after(() => {
    KillSwitch.findOne = originalFindOne;
    KillSwitch.findOneAndUpdate = originalFindOneAndUpdate;
});

test('isActionAllowed returns true when no kill switch exists', async () => {
    KillSwitch.findOne = async () => null;

    const result = await killSwitchService.isActionAllowed('org1', 'webhook');
    assert.equal(result, true);
});

test('isActionAllowed returns false when global kill switch is enabled', async () => {
    KillSwitch.findOne = async () => ({
        global: true,
        perOrganization: new Map(),
        perProvider: new Map(),
    });

    const result = await killSwitchService.isActionAllowed('org1', 'webhook');
    assert.equal(result, false);
});

test('isActionAllowed returns false when organization kill switch is enabled', async () => {
    const perOrganization = new Map();
    perOrganization.set('org1', true);

    KillSwitch.findOne = async () => ({
        global: false,
        perOrganization,
        perProvider: new Map(),
    });

    const result = await killSwitchService.isActionAllowed('org1', 'webhook');
    assert.equal(result, false);
});

test('isActionAllowed returns false when provider kill switch is enabled', async () => {
    const perProvider = new Map();
    perProvider.set('webhook', true);

    KillSwitch.findOne = async () => ({
        global: false,
        perOrganization: new Map(),
        perProvider,
    });

    const result = await killSwitchService.isActionAllowed('org1', 'webhook');
    assert.equal(result, false);
});

test('isActionAllowed returns true when no kill switches are enabled', async () => {
    KillSwitch.findOne = async () => ({
        global: false,
        perOrganization: new Map(),
        perProvider: new Map(),
    });

    const result = await killSwitchService.isActionAllowed('org1', 'webhook');
    assert.equal(result, true);
});

test('isActionAllowed returns true on database error', async () => {
    KillSwitch.findOne = async () => {
        throw new Error('Database error');
    };

    const result = await killSwitchService.isActionAllowed('org1', 'webhook');
    assert.equal(result, true);
});

test('getKillSwitchStatus returns default when no kill switch exists', async () => {
    KillSwitch.findOne = async () => null;

    const result = await killSwitchService.getKillSwitchStatus();
    assert.deepEqual(result, {
        global: false,
        perOrganization: {},
        perProvider: {},
    });
});

test('getKillSwitchStatus returns kill switch data', async () => {
    const killSwitchData = {
        global: true,
        perOrganization: new Map([['org1', true]]),
        perProvider: new Map([['webhook', false]]),
    };

    KillSwitch.findOne = async () => killSwitchData;

    const result = await killSwitchService.getKillSwitchStatus();
    assert.equal(result.global, true);
    assert.equal(result.perOrganization.get('org1'), true);
    assert.equal(result.perProvider.get('webhook'), false);
});

test('updateKillSwitch creates new kill switch', async () => {
    KillSwitch.findOneAndUpdate = async (filter, update, options) => ({
        ...update,
        _id: 'newId',
    });

    const updates = { global: true };
    const updatedBy = 'user1';

    const result = await killSwitchService.updateKillSwitch(updates, updatedBy);
    assert.equal(result.global, true);
    assert.equal(result.updatedBy, 'user1');
});