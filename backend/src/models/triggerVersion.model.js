const mongoose = require('mongoose');

const triggerVersionSchema = new mongoose.Schema({
    triggerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Trigger',
        required: true,
        index: true
    },
    version: {
        type: Number,
        required: true
    },
    snapshot: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    changeType: {
        type: String,
        enum: ['config', 'status'],
        required: true
    },
    changedBy: {
        type: String, // user id or something
        required: true
    },
    changeDescription: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

const TriggerVersion = mongoose.model('TriggerVersion', triggerVersionSchema);

module.exports = TriggerVersion;