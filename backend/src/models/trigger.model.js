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

const WORKFLOW_ACTION_TYPES = ['webhook', 'discord', 'email', 'telegram'];
const WORKFLOW_RUN_IF = ['success', 'failure', 'always'];
const WORKFLOW_STEP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const workflowStepSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        trim: true,
        match: WORKFLOW_STEP_ID_PATTERN,
    },
    name: {
        type: String,
        trim: true,
    },
    actionType: {
        type: String,
        enum: WORKFLOW_ACTION_TYPES,
        required: true,
    },
    actionUrl: {
        type: String,
        trim: true,
    },
    webhookSecret: {
        type: String,
    },
    config: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    runIf: {
        type: String,
        enum: WORKFLOW_RUN_IF,
        default: 'success',
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
        required: function requiredActionUrl() {
            return !this.steps || this.steps.length === 0;
        }
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
    },
    steps: {
        type: [workflowStepSchema],
        default: [],
    },
    workflowConfig: {
        continueOnError: {
            type: Boolean,
            default: false,
        },
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Aggregate health score (0-100)
triggerSchema.virtual('healthScore').get(function() {
    if (this.totalExecutions === 0) return 100;
    const successCount = this.totalExecutions - this.failedExecutions;
    return Math.round((successCount / this.totalExecutions) * 100);
});

// Health status string
triggerSchema.virtual('healthStatus').get(function() {
    const score = this.healthScore;
    if (score >= 90) return 'healthy';
    if (score >= 70) return 'degraded';
    return 'critical';
});

const Trigger = mongoose.model('Trigger', triggerSchema);

module.exports = Trigger;
module.exports.FILTER_OPERATORS = FILTER_OPERATORS;
module.exports.WORKFLOW_ACTION_TYPES = WORKFLOW_ACTION_TYPES;
module.exports.WORKFLOW_RUN_IF = WORKFLOW_RUN_IF;
module.exports.WORKFLOW_STEP_ID_PATTERN = WORKFLOW_STEP_ID_PATTERN;
