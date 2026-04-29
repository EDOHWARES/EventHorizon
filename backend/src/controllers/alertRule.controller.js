const AlertRule = require('../models/alertRule.model');
const alertManagerService = require('../services/alertManager.service');
const logger = require('../config/logger');

/**
 * Controller for alert rule management
 * Supports dashboard and admin operations
 */
const alertRuleController = {
  /**
   * Get all alert rules for organization
   */
  async getAlertRules(req, res) {
    try {
      const { organizationId } = req.user;
      const { active, type, limit = 50, page = 1 } = req.query;

      const filter = { organization: organizationId };
      if (active !== undefined) {
        filter.isActive = active === 'true';
      }
      if (type) {
        filter.alertType = type;
      }

      const rules = await AlertRule.find(filter)
        .populate('createdBy', 'email name')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await AlertRule.countDocuments(filter);

      res.json({
        success: true,
        data: rules,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Get alert rules error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Create new alert rule
   */
  async createAlertRule(req, res) {
    try {
      const { organizationId, _id: userId } = req.user;
      const ruleData = {
        ...req.body,
        organization: organizationId,
        createdBy: userId
      };

      const rule = await AlertRule.create(ruleData);
      await rule.populate('createdBy', 'email name');

      // Test rule evaluation immediately
      const testResult = await alertManagerService.evaluateRule(rule, {});

      res.status(201).json({
        success: true,
        data: rule,
        testResult // Whether conditions would trigger with current empty metrics
      });
    } catch (error) {
      logger.error('Create alert rule error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  },

  /**
   * Get single alert rule
   */
  async getAlertRule(req, res) {
    try {
      const { organizationId } = req.user;
      const { id } = req.params;

      const rule = await AlertRule.findOne({ 
        _id: id, 
        organization: organizationId 
      }).populate('createdBy', 'email name');

      if (!rule) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }

      res.json({ success: true, data: rule });
    } catch (error) {
      logger.error('Get alert rule error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Update alert rule
   */
  async updateAlertRule(req, res) {
    try {
      const { organizationId } = req.user;
      const { id } = req.params;

      const rule = await AlertRule.findOneAndUpdate(
        { _id: id, organization: organizationId },
        req.body,
        { new: true, runValidators: true }
      ).populate('createdBy', 'email name');

      if (!rule) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }

      res.json({ success: true, data: rule });
    } catch (error) {
      logger.error('Update alert rule error:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  },

  /**
   * Delete alert rule
   */
  async deleteAlertRule(req, res) {
    try {
      const { organizationId } = req.user;
      const { id } = req.params;

      const rule = await AlertRule.findOneAndDelete({
        _id: id,
        organization: organizationId
      });

      if (!rule) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }

      res.json({ success: true, message: 'Rule deleted', data: rule });
    } catch (error) {
      logger.error('Delete alert rule error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Test alert rule evaluation
   */
  async testAlertRule(req, res) {
    try {
      const { organizationId } = req.user;
      const { id } = req.params;
      const healthMetrics = req.body || {};

      const rule = await AlertRule.findOne({ 
        _id: id, 
        organization: organizationId 
      });

      if (!rule) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }

      const shouldTrigger = await alertManagerService.evaluateRule(rule, healthMetrics);

      res.json({
        success: true,
        shouldTrigger,
        ruleName: rule.name,
        conditionsMet: shouldTrigger ? 'All conditions satisfied' : 'One or more conditions failed'
      });
    } catch (error) {
      logger.error('Test alert rule error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Get alert history/stats
   */
  async getAlertHistory(req, res) {
    try {
      const { organizationId } = req.user;
      const filters = req.query;

      const history = await alertManagerService.getAlertHistory(organizationId, filters);

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Get alert history error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

module.exports = alertRuleController;

