const mongoose = require('mongoose');

const ipWhitelistSchema = new mongoose.Schema({
    organization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
    },
    cidr: {
        type: String,
        required: true,
        trim: true,
    },
    label: {
        type: String,
        trim: true,
        default: '',
    },
    enabled: {
        type: Boolean,
        default: true,
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
}, {
    timestamps: true,
});

ipWhitelistSchema.index({ organization: 1, cidr: 1 }, { unique: true });

module.exports = mongoose.model('IpWhitelist', ipWhitelistSchema);
