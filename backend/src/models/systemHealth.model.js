const mongoose = require('mongoose');

const systemHealthSchema = new mongoose.Schema({
    organization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
        expires: 2592000, // Auto-delete after 30 days
    },
    // Queue Health
    queue: {
        activeName: String,
        activeCount: {
            type: Number,
            default: 0,
        },
        waitingCount: {
            type: Number,
            default: 0,
        },
        completedCount: {
            type: Number,
            default: 0,
        },
        failedCount: {
            type: Number,
            default: 0,
        },
        delayedCount: {
            type: Number,
            default: 0,
        },
        isPaused: {
            type: Boolean,
            default: false,
        },
    },
    // Database Health
    database: {
        connected: {
            type: Boolean,
            default: false,
        },
        responseTimeMs: {
            type: Number,
            default: 0,
        },
        error: String,
    },
    // API Health
    api: {
        uptime: {
            type: Number,
            default: 0, // milliseconds
        },
        requestCount: {
            type: Number,
            default: 0,
        },
        errorCount: {
            type: Number,
            default: 0,
        },
        avgResponseTimeMs: {
            type: Number,
            default: 0,
        },
        p95ResponseTimeMs: {
            type: Number,
            default: 0,
        },
    },
    // Webhook Health
    webhooks: {
        totalAttempts: {
            type: Number,
            default: 0,
        },
        successCount: {
            type: Number,
            default: 0,
        },
        failureCount: {
            type: Number,
            default: 0,
        },
        rateLimitedCount: {
            type: Number,
            default: 0,
        },
        avgResponseTimeMs: {
            type: Number,
            default: 0,
        },
    },
    // External Services Health
    externalServices: [{
        name: {
            type: String,
            required: true, // e.g., 'slack', 'discord', 'telegram', 'soroban-rpc'
        },
        status: {
            type: String,
            enum: ['healthy', 'degraded', 'unavailable'],
            default: 'healthy',
        },
        lastCheckAt: Date,
        responseTimeMs: Number,
        error: String,
    }],
    // Overall Status
    overallStatus: {
        type: String,
        enum: ['healthy', 'degraded', 'unhealthy'],
        default: 'healthy',
    },
    // Health Score (0-100)
    healthScore: {
        type: Number,
        default: 100,
        min: 0,
        max: 100,
    },
    // Alerts Triggered
    alerts: [{
        ruleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'AlertRule',
        },
        alertType: String, // e.g., 'high_failed_jobs', 'slow_api_response', 'db_unavailable'
        severity: {
            type: String,
            enum: ['info', 'warning', 'critical'],
            default: 'warning',
        },
        message: String,
        triggeredAt: {
            type: Date,
            default: Date.now,
        },
        acknowledged: {
            type: Boolean,
            default: false,
        },
        acknowledgedAt: Date,
        acknowledgedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    }],
}, { timestamps: true });

// Index for efficient health history queries
systemHealthSchema.index({ organization: 1, timestamp: -1 });
systemHealthSchema.index({ organization: 1, overallStatus: 1, timestamp: -1 });

module.exports = mongoose.model('SystemHealth', systemHealthSchema);
