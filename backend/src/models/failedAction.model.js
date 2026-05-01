const mongoose = require('mongoose');

/**
 * Dead Letter Queue (DLQ) - persists failed action attempts for later re-driving.
 */
const failedActionSchema = new mongoose.Schema(
    {
        triggerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Trigger',
            required: true,
            index: true,
        },
        triggerSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        eventPayload: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        errorMessage: {
            type: String,
            required: true,
        },
        attemptsMade: {
            type: Number,
            default: 1,
        },
        status: {
            type: String,
            enum: ['pending', 'redriving', 'resolved', 'purged'],
            default: 'pending',
            index: true,
        },
        resolvedAt: {
            type: Date,
        },
        jobId: {
            type: String,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'failed_actions',
    }
);

failedActionSchema.index({ createdAt: -1 });
failedActionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('FailedAction', failedActionSchema);
