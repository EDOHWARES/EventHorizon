const test = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');

const { sendDiscordNotification } = require('../src/services/discord.service');
const telegramService = require('../src/services/telegram.service');
const webhookService = require('../src/services/webhook.service');

test.before(() => {
    nock.disableNetConnect();
});

test.after(() => {
    nock.cleanAll();
    nock.enableNetConnect();
});

test.afterEach(() => {
    const pending = nock.pendingMocks();
    nock.abortPendingRequests();
    nock.cleanAll();
    assert.equal(pending.length, 0, `Pending HTTP mocks: ${pending.join(', ')}`);
});

test('discord action posts expected payload format', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/test-webhook';
    const payload = {
        embeds: [
            {
                title: 'Event: transfer',
                description: 'Contract: CTEST123',
                fields: [
                    {
                        name: 'Payload',
                        value: '```json\n{"amount":"1000"}\n```',
                    },
                ],
                color: 5793266,
                timestamp: '2026-04-27T00:00:00.000Z',
            },
        ],
    };

    nock('https://discord.com')
        .post('/api/webhooks/test-webhook', (body) => {
            assert.deepEqual(body, payload);
            return true;
        })
        .reply(204);

    const result = await sendDiscordNotification(webhookUrl, payload);

    assert.equal(result.success, true);
    assert.equal(result.status, 204);
});

test('discord action handles 429 response', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/rate-limit';

    nock('https://discord.com')
        .post('/api/webhooks/rate-limit')
        .reply(429, { message: 'You are being rate limited.' });

    const result = await sendDiscordNotification(webhookUrl, { content: 'hello' });

    assert.equal(result.success, false);
    assert.equal(result.status, 429);
});

test('discord action handles 503 response', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/service-unavailable';

    nock('https://discord.com')
        .post('/api/webhooks/service-unavailable')
        .reply(503, { message: 'Service unavailable' });

    const result = await sendDiscordNotification(webhookUrl, { content: 'hello' });

    assert.equal(result.success, false);
    assert.equal(result.status, 503);
});

test('discord action surfaces timeout errors', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/timeout';

    nock('https://discord.com')
        .post('/api/webhooks/timeout')
        .delayConnection(100)
        .reply(204);

    await assert.rejects(
        sendDiscordNotification(webhookUrl, { content: 'hello' }, { timeout: 25 }),
        (error) => error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    );
});

test('telegram action posts expected payload format', async () => {
    const botToken = '123456:ABCDEF_TOKEN';
    const chatId = '999999';
    const text = 'Alert message';

    nock('https://api.telegram.org')
        .post(`/bot${botToken}/sendMessage`, (body) => {
            assert.deepEqual(body, {
                chat_id: chatId,
                text,
                parse_mode: 'MarkdownV2',
            });
            return true;
        })
        .reply(200, { ok: true, result: { message_id: 1 } });

    const result = await telegramService.sendTelegramMessage(botToken, chatId, text);

    assert.equal(result.ok, true);
    assert.equal(result.result.message_id, 1);
});

test('telegram action handles 429 response', async () => {
    const botToken = '123456:ABCDEF_TOKEN';
    const chatId = '999999';

    nock('https://api.telegram.org')
        .post(`/bot${botToken}/sendMessage`)
        .reply(429, {
            ok: false,
            description: 'Too Many Requests: retry later',
        });

    const result = await telegramService.sendTelegramMessage(botToken, chatId, 'hello');

    assert.equal(result.success, false);
    assert.equal(result.status, 429);
    assert.equal(result.message, 'Too Many Requests: retry later');
});

test('telegram action handles 503 response', async () => {
    const botToken = '123456:ABCDEF_TOKEN';
    const chatId = '999999';

    nock('https://api.telegram.org')
        .post(`/bot${botToken}/sendMessage`)
        .reply(503, {
            ok: false,
            description: 'Service unavailable',
        });

    const result = await telegramService.sendTelegramMessage(botToken, chatId, 'hello');

    assert.equal(result.success, false);
    assert.equal(result.status, 503);
    assert.equal(result.message, 'Service unavailable');
});

test('telegram action surfaces timeout errors', async () => {
    const botToken = '123456:ABCDEF_TOKEN';
    const chatId = '999999';

    nock('https://api.telegram.org')
        .post(`/bot${botToken}/sendMessage`)
        .delayConnection(100)
        .reply(200, { ok: true });

    await assert.rejects(
        telegramService.sendTelegramMessage(botToken, chatId, 'hello', { timeout: 25 }),
        (error) => error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    );
});

test('webhook action posts payload with EventHorizon signature headers', async () => {
    const url = 'https://hooks.example.com/events';
    const secret = 'super-secret-key';
    const payload = {
        contractId: 'CTEST123',
        eventName: 'transfer',
        payload: { amount: '1000' },
    };

    let sentSignature;
    let sentTimestamp;

    nock('https://hooks.example.com')
        .matchHeader('x-eventhorizon-signature', (value) => {
            sentSignature = value;
            return /^[a-f0-9]{64}$/.test(value);
        })
        .matchHeader('x-eventhorizon-timestamp', (value) => {
            sentTimestamp = value;
            return !Number.isNaN(Date.parse(value));
        })
        .post('/events', (body) => {
            assert.deepEqual(body, payload);
            return true;
        })
        .reply(200, { received: true });

    const response = await webhookService.sendSignedWebhook(url, payload, secret);

    assert.equal(response.status, 200);
    assert.equal(response.data.received, true);

    const expectedSignature = webhookService.generateSignature(secret, sentTimestamp, payload);
    assert.equal(sentSignature, expectedSignature);
});

test('webhook action surfaces 429 response errors', async () => {
    const url = 'https://hooks.example.com/rate-limit';

    nock('https://hooks.example.com')
        .post('/rate-limit')
        .reply(429, { error: 'rate_limited' });

    await assert.rejects(
        webhookService.sendSignedWebhook(url, { event: 'transfer' }, 'secret'),
        (error) => error.response?.status === 429
    );
});

test('webhook action surfaces 503 response errors', async () => {
    const url = 'https://hooks.example.com/service-unavailable';

    nock('https://hooks.example.com')
        .post('/service-unavailable')
        .reply(503, { error: 'service_unavailable' });

    await assert.rejects(
        webhookService.sendSignedWebhook(url, { event: 'transfer' }, 'secret'),
        (error) => error.response?.status === 503
    );
});

test('webhook action surfaces timeout errors', async () => {
    const url = 'https://hooks.example.com/timeout';

    nock('https://hooks.example.com')
        .post('/timeout')
        .delayConnection(100)
        .reply(200, { ok: true });

    await assert.rejects(
        webhookService.sendSignedWebhook(url, { event: 'transfer' }, 'secret', { timeout: 25 }),
        (error) => error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    );
});