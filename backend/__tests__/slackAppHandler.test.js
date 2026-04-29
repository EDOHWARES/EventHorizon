const assert = require('node:assert/strict');
const { test } = require('node:test');
const slackAppHandler = require('../src/services/slackAppHandler.service');
const slackService = require('../src/services/slack.service');

// Mock dependencies
let mockAlertManager;
let mockQueue;

test('SlackAppHandler - acknowledge button interaction', async (t) => {
  // Mock slackService.resolveCallbackId
  const originalResolve = slackService.resolveCallbackId;
  slackService.resolveCallbackId = () => ({ alertId: 'test-alert-123' });

  mockAlertManager = {
    acknowledgeAlert: async () => { /* noop */ }
  };

  const payload = {
    type: 'block_actions',
    actions: [{ action_id: 'acknowledge_test123' }],
    callback_id: 'test123'
  };

  const result = await slackAppHandler.handleInteraction(payload, 'mock-url');

  assert.equal(result.response_action, 'ephemeral');
  assert.ok(result.text.includes('acknowledged'));

  slackService.resolveCallbackId = originalResolve;
});

test('SlackAppHandler - retry button interaction', async (t) => {
  mockQueue = {
    getFailed: async () => [{ retry: async () => {} }]
  };

  const payload = {
    type: 'block_actions',
    actions: [{ action_id: 'retry_test456' }],
    callback_id: 'test456'
  };

  const result = await slackAppHandler.handleInteraction(payload);

  assert.ok(result.text.includes('Retry triggered'));
});

test('SlackAppHandler - unknown interaction', async (t) => {
  const payload = { type: 'unknown' };
  const result = await slackAppHandler.handleInteraction(payload);

  assert.equal(result.response_action, 'clear');
});

console.log('✅ All Slack App Handler tests passed!');

