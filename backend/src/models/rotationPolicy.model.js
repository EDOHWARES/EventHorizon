const mongoose = require('mongoose');

const rotationPolicySchema = new mongoose.Schema({
    credentialId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Credential',
        required: true,
        index: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    // Rotation interval in hours (e.g. 24 = daily, 168 = weekly)
    intervalHours: {
        type: Number,
        required: true,
        min: 1,
    },
    lastRotatedAt: {
        type: Date,
        default: null,
    },
    nextRotationAt: {
        type: Date,
        required: true,
        index: true,
    },
    enabled: {
        type: Boolean,
        default: true,
    },
}, { timestamps: true });

rotationPolicySchema.index({ nextRotationAt: 1, enabled: 1 });

module.exports = mongoose.model('RotationPolicy', rotationPolicySchema);
