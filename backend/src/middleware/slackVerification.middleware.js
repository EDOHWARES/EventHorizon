const { createVerify } = require('@slack/verify');
const logger = require('../config/logger');

/**
 * Middleware to verify Slack app request signatures and timestamps
 * Required for interactive endpoints (buttons, slash commands)
 */
const slackVerification = (req, res, next) => {
  try {
    // Skip if no signing secret (webhook mode)
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      logger.warn('SLACK_SIGNING_SECRET not set - skipping Slack app verification');
      return next();
    }

    const slackSignature = req.get('X-Slack-Signature');
    const timestampHeader = req.get('X-Slack-Request-Timestamp');

    if (!slackSignature || !timestampHeader) {
      return res.status(400).json({ error: 'Missing Slack headers' });
    }

    // Check timestamp staleness (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const requestTimestamp = parseInt(timestampHeader, 10);
    const timeInSeconds = Math.abs(now - requestTimestamp);

    if (timeInSeconds > 300) {
      logger.warn('Slack request timestamp too old:', { timeInSeconds });
      return res.status(400).json({ error: 'Request timestamp too old' });
    }

    // Verify signature
    const verifier = createVerify(signingSecret);
    const body = new URLSearchParams();
    Object.keys(req.body).forEach(key => {
      body.append(key, req.body[key]);
    });

    const requestBody = body.toString();
    const isVerified = verifier(slackSignature, requestBody, timestampHeader);

    if (!isVerified) {
      logger.warn('Slack signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Attach verified payload_type and body to req
    req.slackPayload = {
      payload_type: req.body.payload_type || req.body.type,
      body: requestBody,
      ...req.body
    };

    logger.info('Slack request verified successfully', { payload_type: req.slackPayload.payload_type });
    next();
  } catch (error) {
    logger.error('Slack verification error:', error.message);
    res.status(500).json({ error: 'Verification failed' });
  }
};

module.exports = slackVerification;

