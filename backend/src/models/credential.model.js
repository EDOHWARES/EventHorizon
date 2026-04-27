const mongoose = require('mongoose');

const credentialSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, required: true }, // e.g., 'slack', 'google'
    externalAccountId: { type: String }, // e.g., Slack Workspace ID or Google Email
    accountName: { type: String }, // Human readable label (e.g., "Engineering Slack")
    accessToken: { type: String, required: true }, // Encrypted at rest
    refreshToken: { type: String }, // Encrypted at rest
    expiresAt: { type: Date }, // Nullable if token doesn't expire (like older Slack tokens)
    scopes: [{ type: String }],
    status: { 
        type: String, 
        enum: ['active', 'expired', 'revoked'], 
        default: 'active' 
    }
}, { timestamps: true });

// Ensure quick lookups for active tokens per user and provider
credentialSchema.index({ userId: 1, provider: 1, status: 1 });

module.exports = mongoose.model('Credential', credentialSchema);