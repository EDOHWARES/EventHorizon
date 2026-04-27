const mongoose = require('mongoose');

/**
 * Audit log schema for tracking all trigger operations
 * Designed to be immutable with restricted access
 */
const auditLogSchema = new mongoose.Schema({
    // Organization context
    organization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
    },

    // What happened
    operation: {
        type: String,
        required: true,
        enum: ['CREATE', 'UPDATE', 'DELETE'],
        index: true
    },

    // Which resource
    resourceType: {
        type: String,
        required: true,
        default: 'Trigger',
        index: true
    },
    resourceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },

    // Who performed the action
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    },
    userAgent: {
        type: String,
        required: true
    },

    // Where (network info)
    ipAddress: {
        type: String,
        required: true,
        index: true
    },
    forwardedFor: {
        type: String
    },

    // When
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },

    // What changed (for updates)
    changes: {
        before: {
            type: mongoose.Schema.Types.Mixed
        },
        after: {
            type: mongoose.Schema.Types.Mixed
        },
        diff: [{
            field: String,
            oldValue: mongoose.Schema.Types.Mixed,
            newValue: mongoose.Schema.Types.Mixed
        }]
    },

    // Additional context
    metadata: {
        endpoint: String,
        method: String,
        userAgent: String,
        sessionId: String,
        requestId: String
    },

    // Security hash for integrity verification
    integrityHash: {
        type: String,
        index: true
    }
}, {
    timestamps: false, // We use our own timestamp field
    collection: 'audit_logs'
});

// Compound indexes for efficient querying
auditLogSchema.index({ resourceId: 1, timestamp: -1 });
auditLogSchema.index({ operation: 1, timestamp: -1 });
auditLogSchema.index({ ipAddress: 1, timestamp: -1 });

// Virtual for formatted timestamp
auditLogSchema.virtual('formattedTimestamp').get(function() {
    return this.timestamp.toISOString();
});

// Method to calculate integrity hash
auditLogSchema.methods.calculateIntegrityHash = function() {
    const crypto = require('crypto');
    const data = JSON.stringify({
        operation: this.operation,
        resourceType: this.resourceType,
        resourceId: this.resourceId.toString(),
        userId: this.userId,
        ipAddress: this.ipAddress,
        timestamp: this.timestamp.toISOString(),
        changes: this.changes
    });

    return crypto.createHash('sha256').update(data).digest('hex');
};

// Pre-save middleware to ensure integrity hash
auditLogSchema.pre('save', function(next) {
    if (!this.integrityHash) {
        this.integrityHash = this.calculateIntegrityHash();
    }
    next();
});

// Static method to create audit log entry
auditLogSchema.statics.createLog = async function(options) {
    const {
        operation,
        resourceType = 'Trigger',
        resourceId,
        organization,
        userId,
        userAgent,
        ipAddress,
        forwardedFor,
        changes,
        metadata
    } = options;

    const logEntry = new this({
        operation,
        resourceType,
        resourceId,
        organization,
        userId,
        userAgent,
        ipAddress,
        forwardedFor,
        changes,
        metadata
    });

    await logEntry.save();
    return logEntry;
};

// Static method to get audit trail for a resource
auditLogSchema.statics.getAuditTrail = function(resourceId, options = {}) {
    const { limit = 50, skip = 0, operations, organization } = options;

    let query = { resourceId };
    if (organization) query.organization = organization;
    if (operations && operations.length > 0) {
        query.operation = { $in: operations };
    }

    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(skip)
        .populate('resourceId', 'contractId eventName actionType');
};

// Static method to verify log integrity
auditLogSchema.statics.verifyIntegrity = async function(logId) {
    const log = await this.findById(logId);
    if (!log) return false;

    const calculatedHash = log.calculateIntegrityHash();
    return calculatedHash === log.integrityHash;
};

module.exports = mongoose.model('AuditLog', auditLogSchema);