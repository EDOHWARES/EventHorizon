const express = require('express');
const router = express.Router();
const slackAppHandler = require('../services/slackAppHandler.service');
const slackVerification = require('../middleware/slackVerification.middleware');

/**
 * @swagger
 * /api/slack/interactions:
 *   post:
 *     summary: Handle Slack app interactions (buttons, slash commands)
 *     tags: [Slack]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 */
router.post('/interactions', 
  slackVerification,
  async (req, res) => {
    const response = await slackAppHandler.handleInteraction(
      req.slackPayload, 
      req.body.response_url
    );
    
    // Slack expects 200 OK within 3 seconds
    res.status(200).json(response);
  }
);

module.exports = router;

