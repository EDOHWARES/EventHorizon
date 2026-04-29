const systemHealthMonitorService = require('./systemHealthMonitor.service');
const alertManagerService = require('./alertManager.service');
const Organization = require('../models/organization.model');
const logger = require('../config/logger');

/**
 * Service to schedule and manage periodic health checks
 */
class HealthCheckSchedulerService {
    constructor() {
        this.intervals = new Map(); // Store interval IDs per organization
        this.CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || 300000); // 5 minutes default
    }

    /**
     * Start health checks for all organizations
     */
    async startHealthChecksForAllOrganizations() {
        try {
            const organizations = await Organization.find({ isActive: true });
            
            for (const org of organizations) {
                this.startHealthCheckForOrganization(org._id);
            }
            
            logger.info(`Started health checks for ${organizations.length} organizations`);
        } catch (error) {
            logger.error('Failed to start health checks for all organizations:', error.message);
        }
    }

    /**
     * Start periodic health check for a specific organization
     * @param {String} organizationId - Organization ID
     */
    startHealthCheckForOrganization(organizationId) {
        // Don't start duplicate intervals
        if (this.intervals.has(organizationId)) {
            logger.warn(`Health check already running for organization ${organizationId}`);
            return;
        }

        // Run initial check immediately
        this.performHealthCheck(organizationId).catch(err => {
            logger.error(`Initial health check failed for org ${organizationId}:`, err.message);
        });

        // Schedule periodic checks
        const intervalId = setInterval(() => {
            this.performHealthCheck(organizationId).catch(err => {
                logger.error(`Health check failed for org ${organizationId}:`, err.message);
            });
        }, this.CHECK_INTERVAL_MS);

        this.intervals.set(organizationId, intervalId);
        logger.info(`Health check started for organization ${organizationId} (interval: ${this.CHECK_INTERVAL_MS}ms)`);
    }

    /**
     * Stop health check for an organization
     * @param {String} organizationId - Organization ID
     */
    stopHealthCheckForOrganization(organizationId) {
        if (this.intervals.has(organizationId)) {
            clearInterval(this.intervals.get(organizationId));
            this.intervals.delete(organizationId);
            logger.info(`Health check stopped for organization ${organizationId}`);
        }
    }

    /**
     * Stop all health checks
     */
    stopAllHealthChecks() {
        for (const [organizationId, intervalId] of this.intervals.entries()) {
            clearInterval(intervalId);
        }
        this.intervals.clear();
        logger.info('All health checks stopped');
    }

    /**
     * Perform a single health check for an organization
     * @param {String} organizationId - Organization ID
     */
    async performHealthCheck(organizationId) {
        try {
            // Collect health metrics
            const healthMetrics = await systemHealthMonitorService.collectHealthMetrics(organizationId);

            // Save to database
            await systemHealthMonitorService.saveHealthMetrics(healthMetrics);

            // Evaluate alert rules and send notifications
            const triggeredAlerts = await alertManagerService.evaluateAlerts(organizationId, healthMetrics);
            
            if (triggeredAlerts.length > 0) {
                const results = await alertManagerService.sendAlertNotifications(
                    triggeredAlerts,
                    organizationId
                );
                
                logger.info(`Health check for org ${organizationId}: ${triggeredAlerts.length} alerts triggered`, {
                    results
                });
            } else {
                logger.debug(`Health check for org ${organizationId}: All systems normal`);
            }
        } catch (error) {
            logger.error(`Error during health check for org ${organizationId}:`, error.message);
        }
    }

    /**
     * Manually trigger a health check
     * @param {String} organizationId - Organization ID
     */
    async triggerManualHealthCheck(organizationId) {
        return await this.performHealthCheck(organizationId);
    }

    /**
     * Get current interval for organization
     * @param {String} organizationId - Organization ID
     */
    getInterval(organizationId) {
        return this.intervals.get(organizationId);
    }

    /**
     * Get all active intervals
     */
    getActiveIntervals() {
        return Array.from(this.intervals.keys());
    }

    /**
     * Change health check interval
     * @param {Number} intervalMs - New interval in milliseconds
     */
    changeCheckInterval(intervalMs) {
        this.CHECK_INTERVAL_MS = intervalMs;
        
        // Restart all health checks with new interval
        const organizations = Array.from(this.intervals.keys());
        for (const orgId of organizations) {
            this.stopHealthCheckForOrganization(orgId);
            this.startHealthCheckForOrganization(orgId);
        }
        
        logger.info(`Health check interval changed to ${intervalMs}ms`);
    }
}

module.exports = new HealthCheckSchedulerService();
