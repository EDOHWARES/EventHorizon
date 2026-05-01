const telegramService = require('./telegram.service');
const webhookService = require('./webhook.service');

function workflowPayload(context, stepId) {
    if (!context) return undefined;

    return {
        runId: context.runId,
        stepId,
        previousSteps: context.steps,
        stepOrder: context.stepOrder,
        lastResult: context.lastResult,
    };
}

async function executeSingleAction(trigger, eventPayload, options = {}) {
    const { actionType, actionUrl, contractId, eventName } = trigger;
    const { context, stepId, webhookPayload } = options;

    switch (actionType) {
        case 'email': {
            const { sendEventNotification } = require('./email.service');
            return await sendEventNotification({
                trigger,
                payload: eventPayload,
            });
        }

        case 'discord': {
            const { sendDiscordNotification } = require('./discord.service');
            if (!actionUrl) {
                throw new Error('Missing actionUrl for Discord trigger');
            }

            const discordPayload = {
                embeds: [{
                    title: `Event: ${eventName}`,
                    description: `Contract: ${contractId}`,
                    fields: [
                        {
                            name: 'Payload',
                            value: `\`\`\`json\n${JSON.stringify(eventPayload, null, 2).slice(0, 1000)}\n\`\`\``,
                        },
                    ],
                    color: 0x5865F2,
                    timestamp: new Date().toISOString(),
                }],
            };

            return await sendDiscordNotification(actionUrl, discordPayload);
        }

        case 'telegram': {
            const botToken = trigger.botToken || trigger.config?.botToken || process.env.TELEGRAM_BOT_TOKEN;
            const chatId = trigger.chatId || trigger.config?.chatId || actionUrl;
            if (!botToken || !chatId) {
                throw new Error('Missing botToken or chatId for Telegram trigger');
            }

            const message = trigger.config?.message || `🔔 *Event Triggered*\n\n` +
                `*Event:* ${telegramService.escapeMarkdownV2(eventName)}\n` +
                `*Contract:* \`${telegramService.escapeMarkdownV2(contractId)}\`\n\n` +
                `*Payload:*\n\`\`\`\n${telegramService.escapeMarkdownV2(JSON.stringify(eventPayload, null, 2))}\n\`\`\``;

            return await telegramService.sendTelegramMessage(botToken, chatId, message);
        }

        case 'webhook': {
            if (!actionUrl) {
                throw new Error('Missing actionUrl for webhook trigger');
            }

            const payload = webhookPayload || {
                contractId,
                eventName,
                payload: eventPayload,
            };
            const workflow = workflowPayload(context, stepId);
            if (workflow) {
                payload.workflow = workflow;
            }

            return await webhookService.sendSignedWebhook(
                actionUrl,
                payload,
                trigger.webhookSecret || trigger.config?.webhookSecret,
                { organizationId: trigger.organization }
            );
        }

        default:
            throw new Error(`Unsupported action type: ${actionType}`);
    }
}

module.exports = {
    executeSingleAction,
};
