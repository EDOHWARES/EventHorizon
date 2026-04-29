const mongoose = require('mongoose');

const FILTER_OPERATORS = [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'in',
    'exists',
];

const filterSchema = new mongoose.Schema({
    path: {
        type: String,
        required: true,
        trim: true,
    },
    operator: {
        type: String,
        enum: FILTER_OPERATORS,
        required: true,
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
    },
}, { _id: false });

const triggerSchema = new mongoose.Schema({
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
    contractId: {
        type: String,
        required: true,
        index: true
    },
    eventName: {
        type: String,
        required: true
    },
    actionType: {
        type: String,
        enum: ['webhook', 'discord', 'email', 'telegram'],
        default: 'webhook'
    },
    actionUrl: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastPolledLedger: {
        type: Number,
        default: 0
    },
    // Detailed Statistics & Health
    totalExecutions: {
        type: Number,
        default: 0
    },
    failedExecutions: {
        type: Number,
        default: 0
    },
    lastSuccessAt: {
        type: Date
    },
    // Health Check & Failure Tracking
    lastHealthCheckAt: {
        type: Date
    },
    consecutiveFailures: {
        type: Number,
        default: 0
    },
    healthCheckConfig: {
        enabled: {
            type: Boolean,
            default: true
        },
        intervalMs: {
            type: Number,
            default: 3600000, // 1 hour
            min: 60000, // 1 minute
            max: 86400000 // 1 day
        }
    },
    // Configuration & Metadata
    retryConfig: {
        maxRetries: {
            type: Number,
            default: 3
        },
        retryIntervalMs: {
            type: Number,
            default: 5000
        }
    },
    batchingConfig: {
        enabled: {
            type: Boolean,
            default: false
        },
        windowMs: {
            type: Number,
            default: 10000, // 10 seconds
            min: 1000,
            max: 300000 // 5 minutes
        },
        maxBatchSize: {
            type: Number,
            default: 50,
            min: 1,
            max: 1000
        },
        continueOnError: {
            type: Boolean,
            default: true // Continue processing other events in batch if one fails
        }
    },
    metadata: {
        type: Map,
        of: String,
        index: true
    },
    filters: {
        type: [filterSchema],
        default: [],
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Threshold for auto-disabling triggers
const MAX_CONSECUTIVE_FAILURES = 5;

// Aggregate health score (0-100)
triggerSchema.virtual('healthScore').get(function() {
    if (this.totalExecutions === 0) return 100;
    const successCount = this.totalExecutions - this.failedExecutions;
    return Math.round((successCount / this.totalExecutions) * 100);
});

// Health status string
triggerSchema.virtual('healthStatus').get(function() {
    if (!this.isActive) return 'disabled';
    const score = this.healthScore;
    if (score >= 90 && this.consecutiveFailures === 0) return 'healthy';
    if (score >= 70 && this.consecutiveFailures < 3) return 'degraded';
    return 'critical';
});

/**
 * Handle a successful execution
 */
triggerSchema.methods.handleSuccess = async function() {
    this.totalExecutions += 1;
    this.consecutiveFailures = 0;
    this.lastSuccessAt = new Date();
    return this.save();
};

/**
 * Handle a failed execution
 */
triggerSchema.methods.handleFailure = async function(error) {
    this.totalExecutions += 1;
    this.failedExecutions += 1;
    this.consecutiveFailures += 1;

    let autoDisabled = false;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.isActive = false;
        autoDisabled = true;
    }

    await this.save();
    return { autoDisabled, consecutiveFailures: this.consecutiveFailures };
};

const Trigger = mongoose.model('Trigger', triggerSchema);

module.exports = Trigger;
module.exports.FILTER_OPERATORS = FILTER_OPERATORS;
module.exports.MAX_CONSECUTIVE_FAILURES = MAX_CONSECUTIVE_FAILURES;
