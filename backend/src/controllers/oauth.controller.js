const axios = require('axios');
const Credential = require('../models/credential.model');
const { encrypt } = require('../utils/encryption');
const { PROVIDERS } = require('../services/oauth.service');
const breakers = require('../services/circuitBreaker');
const logger = require('../config/logger');

/**
 * Generate the authorization URL and redirect the user.
 * GET /api/auth/:provider
 */
exports.authorize = (req, res) => {
    const { provider } = req.params;
    
    // Example implementations for generating URLs
    if (provider === 'slack') {
        const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${PROVIDERS.slack.clientId}&scope=chat:write,chat:write.public&user_scope=&redirect_uri=${process.env.APP_URL}/api/auth/slack/callback&state=${req.user._id}`;
        return res.redirect(slackUrl);
    }
    
    if (provider === 'google') {
        const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${PROVIDERS.google.clientId}&redirect_uri=${process.env.APP_URL}/api/auth/google/callback&response_type=code&scope=https://www.googleapis.com/auth/spreadsheets&access_type=offline&prompt=consent&state=${req.user._id}`;
        return res.redirect(googleUrl);
    }

    return res.status(400).json({ success: false, message: 'Unsupported provider' });
};

/**
 * Handle the OAuth callback, exchange code for tokens, and securely store them.
 * GET /api/auth/:provider/callback
 */
exports.callback = async (req, res) => {
    const { provider } = req.params;
    const { code, state, error } = req.query;

    if (error) {
        return res.redirect(`${process.env.FRONTEND_URL}/dashboard/integrations?error=${error}`);
    }

    const config = PROVIDERS[provider];
    const userId = state; // We passed userId as 'state' in authorize

    try {
        const response = await breakers.fire(
            `oauth:${provider}`,
            (tokenUrl, body, cfg) => axios.post(tokenUrl, body, cfg),
            [
                config.tokenUrl,
                new URLSearchParams({
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    code,
                    redirect_uri: `${process.env.APP_URL}/api/auth/${provider}/callback`,
                    grant_type: 'authorization_code'
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            ]
        );

        const { access_token, refresh_token, expires_in, scope } = response.data;

        // Depending on the provider, parse the external account information
        let externalAccountId = null;
        let accountName = null;
        
        if (provider === 'slack') {
            externalAccountId = response.data.team?.id;
            accountName = response.data.team?.name;
        }
        // Extract details for Google, Github, etc.

        // Update or create the credential securely
        await Credential.findOneAndUpdate(
            { userId, provider },
            {
                userId,
                provider,
                externalAccountId,
                accountName,
                accessToken: encrypt(access_token),
                refreshToken: refresh_token ? encrypt(refresh_token) : undefined,
                expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
                scopes: scope ? scope.split(',') : [],
                status: 'active'
            },
            { upsert: true, new: true }
        );

        res.redirect(`${process.env.FRONTEND_URL}/dashboard/integrations?success=true&provider=${provider}`);
    } catch (err) {
        logger.error(`OAuth callback error for ${provider}`, { error: err.message, response: err.response?.data });
        res.redirect(`${process.env.FRONTEND_URL}/dashboard/integrations?error=auth_failed`);
    }
};