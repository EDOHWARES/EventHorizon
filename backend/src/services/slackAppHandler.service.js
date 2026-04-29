const slackService = require('./slack.service');
const alertManagerService = require('./alertManager.service');
const logger = require('../config/logger');
const SystemHealth = require('../models/systemHealth.model');

/**
 * Service to handle Slack app interactions (button clicks, slash commands)
 * Integrates with existing alert system
 */
class SlackAppHandlerService {
  /**
   * Main entry point for Slack interactions
   * @param {Object} payload - Verified Slack payload from middleware
   * @param {string} webhookResponseUrl - Slack response_url for ephemeral updates
   * @returns {Promise<Object>} Response for Slack
   */
  async handleInteraction(payload, webhookResponseUrl) {
    try {
      const { type, actions, callback_id, channel } = payload;

      logger.info('Processing Slack interaction', { 
        type, 
        callback_id, 
        channel: channel.id,
        actions: actions?.map(a => a.action_id)
      });

      // Handle block actions (buttons)
      if (type === 'block_actions') {
        return await this.handleBlockActions(payload, webhookResponseUrl);
      }

      // Handle view submissions (modals)
      if (type === 'view_submission') {
        return await this.handleViewSubmission(payload);
      }

      return {
        response_action: 'clear'
      };
    } catch (error) {
      logger.error('Slack interaction handler error:', error.message);
      return {
        response_action: 'ephemeral',
        text: 'Sorry, an error occurred processing your request. Please try again.'
      };
    }
  }

  /**
   * Handles button clicks (Acknowledge, Retry)
   */
  async handleBlockActions(payload, webhookResponseUrl) {
    const actions = payload.actions || [];
    const callbackId = payload.callback_id;

    const results = [];

    for (const action of actions) {
      const { action_id, value, block_id } = action;

      if (action_id.startsWith('acknowledge_')) {
        const alertId = slackService.resolveCallbackId(callbackId)?.alertId;
        if (alertId) {
          await alertManagerService.acknowledgeAlert(alertId, 'slack_user');
          results.push(`✅ Alert *${alertId.slice(-6)}* acknowledged`);
          
          // Update Slack message
          await this.updateAlertMessage(webhookResponseUrl, 'Alert acknowledged!');
        }
      } else if (action_id.startsWith('retry_')) {
        // Trigger retry logic for failed jobs/alerts
        results.push(await this.handleRetryAction(callbackId));
      } else if (action_id.startsWith('view_health_')) {
        results.push('📊 Check the dashboard for detailed health metrics');
      }
    }

    return {
      response_action: 'ephemeral',
      text: results.length > 0 ? results.join('\n') : 'Action processed.'
    };
  }

  /**
   * Updates original Slack message after interaction
   */
  async updateAlertMessage(responseUrl, statusMessage) {
    try {
      const updatePayload = {
        text: statusMessage,
        replace_original: true
      };
      await slackService.updateSlackMessage(responseUrl, updatePayload);
    } catch (error) {
      logger.error('Failed to update Slack message:', error.message);
    }
  }

  /**
   * Handles retry actions (retry failed jobs, re-check health)
   */
  async handleRetryAction(callbackId) {
    try {
      // Example: Retry failed queue jobs
      // This would integrate with existing queue retry endpoints
      const result = await this.retryRecentFailedJobs();
      
      return `🔄 Retry triggered: ${result.jobsRetried || 0} failed jobs queued for retry`;
    } catch (error) {
      logger.error('Retry action failed:', error.message);
      return '❌ Retry failed - check logs';
    }
  }

  /**
   * Retries recent failed jobs (integrates with existing queue system)
   */
  async retryRecentFailedJobs() {
    // Integration point with queue.controller.js retryJob endpoint
    // This would call the existing API or directly interact with BullMQ queues
    const { getActionQueue } = require('../worker/queue');
    
    let totalRetried = 0;
    try {
      const queue = getActionQueue();
      const failedJobs = await queue.getFailed();
      
      for (const job of failedJobs.slice(0, 5)) { // Limit to recent 5
        await job.retry();
        totalRetried++;
      }
    } catch (error) {
      logger.error('Failed to retry jobs:', error.message);
    }
    
    return { jobsRetried: totalRetried };
  }

  /**
   * Handles modal/view submissions (future: create alert rules from Slack)
   */
  async handleViewSubmission(payload) {
    // Placeholder for advanced features
    // e.g., "Create Alert Rule" modal from slash command
    logger.info('View submission received:', payload.view.private_metadata);
    
    return {
      response_action: 'clear'
    };
  }

  /**
   * Slash command handler (future: /eventhorizon status, /alert create)
   */
  async handleSlashCommand(payload) {
    const { command, text, channel_id } = payload;

    if (command === '/eventhorizon' && text === 'status') {
      const health = await this.getCurrentHealthStatus();
      return {
        response_type: 'in_channel',
        blocks: slackService.buildSystemHealthAlert(health)
      };
    }

    return {
      response_type: 'ephemeral',
      text: 'Available commands: `status` - Get system health'
    };
  }

  /**
   * Gets formatted current health for slash commands
   */
  async getCurrentHealthStatus() {
    const systemHealthMonitorService = require('./systemHealthMonitor.service');
    return await systemHealthMonitorService.collectHealthMetrics('global');
  }
}

module.exports = new SlackAppHandlerService();

