const mongoose = require('mongoose');

const conditionSchema = new mongoose.Schema({
    metric: {
        type: String,
        required: true,
        enum: [
            // Queue metrics
            'queue.activeCount',
            'queue.waitingCount',
            'queue.failedCount',
            'queue.delayedCount',
            // API metrics
            'api.errorCount',
            'api.avgResponseTimeMs',
            'api.p95ResponseTimeMs',
            // Webhook metrics
            'webhooks.failureCount',
            'webhooks.rateLimitedCount',
            'webhooks.avgResponseTimeMs',
            // Database metrics
            'database.responseTimeMs',
            // External services
            'externalServices.status',
            // Overall
            'healthScore',
            'overallStatus',
        ]
    },
    operator: {
        type: String,
        required: true,
        enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'contains'],
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
    },
    // Optional: for service-specific checks
    serviceName: String, // e.g., 'slack', 'discord' for externalServices.status checks
}, { _id: false });

const alertRuleSchema = new mongoose.Schema({
    organization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        trim: true,
    },
    // Alert Configuration
    alertType: {
        type: String,
        required: true,
        enum: [
            'high_failed_jobs',
            'slow_api_response',
            'db_unavailable',
            'high_webhook_failures',
            'webhook_rate_limited',
            'external_service_down',
            'high_error_rate',
            'queue_backed_up',
            'low_health_score',
            'custom'
        ]
    },
    severity: {
        type: String,
        enum: ['info', 'warning', 'critical'],
        default: 'warning',
    },
    // Conditions (all must be met for alert to trigger)
    conditions: [conditionSchema],
    // Evaluation window in seconds
    windowSeconds: {
        type: Number,
        default: 300, // 5 minutes
        min: 60,
        max: 86400, // 1 day
    },
    // Notification targets
    notificationChannels: [{
        type: String,
        required: true,
        enum: ['slack', 'discord', 'email', 'webhook'],
    }],
    slackConfig: {
        channelId: String,
        webhookUrl: String, // Fallback webhook URL
        mentionUsers: [String], // Slack user IDs to mention
        mentionGroups: [String], // Slack user group IDs
    },
    discordConfig: {
        webhookUrl: String,
        roleIds: [String], // Discord roles to mention
    },
    emailConfig: {
        recipients: [String],
        cc: [String],
    },
    webhookConfig: {
        url: {
            type: String,
            required: false,
        },
        headers: {
            type: Map,
            of: String,
        },
    },
    // Throttling
    throttleConfig: {
        enabled: {
            type: Boolean,
            default: true,
        },
        minIntervalMinutes: {
            type: Number,
            default: 15, // Don't send same alert more than once per 15 minutes
            min: 1,
        },
    },
    // Rule Status
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },
    isEnabled: {
        type: Boolean,
        default: true,
    },
    // Alert History
    lastTriggeredAt: Date,
    lastFiredAlert: {
        timestamp: Date,
        conditions: [Object], // Snapshot of conditions that triggered
        healthSnapshot: Object, // Snapshot of system health at trigger time
    },
    // Stats
    triggerCount: {
        type: Number,
        default: 0,
    },
    lastAcknowledgedAt: Date,
    acknowledgedCount: {
        type: Number,
        default: 0,
    },
}, { timestamps: true });

// Index for efficient queries
alertRuleSchema.index({ organization: 1, isActive: 1 });
alertRuleSchema.index({ organization: 1, alertType: 1 });
alertRuleSchema.index({ organization: 1, lastTriggeredAt: -1 });

module.exports = mongoose.model('AlertRule', alertRuleSchema);
