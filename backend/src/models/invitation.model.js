const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired', 'cancelled'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Index for token lookup
// invitationSchema.index({ token: 1 }); // Removed - unique: true creates index automatically

// Auto-expire invitations
invitationSchema.pre('save', function(next) {
  if (this.isModified('expiresAt') || this.isNew) {
    // Could set up a job to clean expired, but for now just check on use
  }
  next();
});

module.exports = mongoose.model('Invitation', invitationSchema);