const axios = require('axios');
const breakers = require('./circuitBreaker');

/**
 * Service to handle Telegram Bot notifications
 */
class TelegramService {
    /**
     * Sends a message to a Telegram chat via the Telegram Bot API.
     * 
     * @param {string} botToken - The Telegram Bot Token.
     * @param {string|number} chatId - The target Telegram Chat ID.
     * @param {string} text - The message text to send.
     * @returns {Promise<Object>} The API response data.
     */
    async sendTelegramMessage(botToken, chatId, text) {
        if (!botToken || !chatId || !text) {
            throw new Error('Telegram Bot Token, Chat ID, and message text are required.');
        }

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        try {
            const response = await breakers.fire(
                'telegram',
                (postUrl, body) => axios.post(postUrl, body),
                [url, {
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'MarkdownV2'
                }]
            );

            return response.data;
        } catch (error) {
            if (error.code === 'CIRCUIT_OPEN') {
                console.error('Telegram circuit breaker OPEN — fast-failing.');
                return { success: false, status: 503, message: 'circuit_open' };
            }
            // Graceful error handling for common Telegram API issues
            if (error.response) {
                const { status, data } = error.response;
                
                // Common Telegram errors:
                // 400 - Chat not found, invalid chat ID, or malformed MarkdownV2
                // 401 - Invalid Bot Token
                // 403 - Bot was blocked by the user
                
                if (status === 400 && data.description.includes('chat not found')) {
                    console.error(`Telegram Error: Chat ID ${chatId} not found.`);
                } else if (status === 401) {
                    console.error('Telegram Error: Invalid Bot Token.');
                } else if (status === 403) {
                    console.error(`Telegram Error: Bot blocked by user in chat ${chatId}.`);
                } else {
                    console.error('Telegram API Error:', data.description || error.message);
                }
                
                // Return a structured error response instead of crashing
                return { success: false, status, message: data.description };
            }

            console.error('Telegram Service Error:', error.message);
            throw error;
        }
    }

    /**
     * Escapes characters for Telegram's MarkdownV2 as required.
     * Characters that must be escaped: '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
     * 
     * @param {string} text - The raw text to escape.
     * @returns {string} The escaped text.
     */
    escapeMarkdownV2(text) {
        // Characters that must be escaped for MarkdownV2:
        // '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
        return text.replace(/[_\*\[\]\(\)~`>#\+\-=\|{}\.\!]/g, '\\$&');
    }
}

module.exports = new TelegramService();
