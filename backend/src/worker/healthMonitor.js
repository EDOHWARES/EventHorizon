const cron = require('node-cron');
const systemHealthMonitorService = require('../services/systemHealthMonitor.service');
const alertManagerService = require('../services/alertManager.service');
const logger = require('../config/logger');
const AlertRule = require('../models/alertRule.model');

/**
 * Background worker for periodic system health monitoring and alerting
 * Runs every 2 minutes by default
 */
class HealthMonitorWorker {
  constructor() {
    this.isRunning = false;
    this.organizationCache = new Map(); // Cache orgs for efficiency
  }

  /**
   * Start the health monitoring cron job
   * @param {string} cronExpression - Cron schedule (default: every 2 min)
   */
  start(cronExpression = '*/2 * * * *') {
    if (this.isRunning) {
      logger.warn('Health monitor already running');
      return;
    }

    this.task = cron.schedule(cronExpression, async () => {
      await this.runHealthCheck();
    });

    logger.info(`Health monitor started: ${cronExpression}`);
    this.isRunning = true;
  }

  /**
   * Stop the health monitor
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.isRunning = false;
      logger.info('Health monitor stopped');
    }
  }

  /**
   * Main health check cycle
   */
  async runHealthCheck() {
    try {
      logger.debug('Running health check cycle');

      // Get all organizations with active alert rules
      const organizations = await this.getOrganizationsWithRules();

      for (const orgId of organizations) {
        await this.checkOrganizationHealth(orgId);
      }

      logger.info('Health check cycle completed', { organizations: organizations.length });
    } catch (error) {
      logger.error('Health check cycle failed:', error.message);
    }
  }

  /**
   * Get organizations that have active alert rules
   */
  async getOrganizationsWithRules() {
    const orgs = await AlertRule.distinct('organization', {
      isActive: true,
      isEnabled: true
    });

    return orgs;
  }

  /**
   * Check health for single organization
   */
  async checkOrganizationHealth(organizationId) {
    try {
      // Collect metrics
      const metrics = await systemHealthMonitorService.collectHealthMetrics(organizationId);
      
      // Save metrics
      const savedMetrics = await systemHealthMonitorService.saveHealthMetrics(metrics);

      // Evaluate alerts
      const triggeredAlerts = await alertManagerService.evaluateAlerts(organizationId, metrics);

      if (triggeredAlerts.length > 0) {
        logger.warn(`Alerts triggered for org ${organizationId}: ${triggeredAlerts.length}`, {
          organizationId,
          alertNames: triggeredAlerts.map(a => a.rule.name)
        });

        // Send notifications
        const results = await alertManagerService.sendAlertNotifications(
          triggeredAlerts, 
          organizationId
        );

        logger.info('Alert notifications sent', { 
          organizationId, 
          results: results.map(r => ({ ruleId: r.ruleId, status: r.status }))
        });
      }

      // Update cache
      this.organizationCache.set(organizationId, {
        lastChecked: new Date(),
        healthScore: metrics.healthScore,
        status: metrics.overallStatus,
        alerts: triggeredAlerts.length
      });

    } catch (error) {
      logger.error(`Health check failed for org ${organizationId}:`, error.message);
    }
  }

  /**
   * Get current monitor status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      organizationsMonitored: this.organizationCache.size,
      lastCycle: Array.from(this.organizationCache.values()).map(o => ({
        orgId: o.orgId,
        healthScore: o.healthScore,
        status: o.status,
        alerts: o.alerts,
        lastChecked: o.lastChecked
      }))
    };
  }

  /**
   * Trigger manual health check for specific org
   */
  async triggerManualCheck(organizationId) {
    return await this.checkOrganizationHealth(organizationId);
  }
}

module.exports = new HealthMonitorWorker();

