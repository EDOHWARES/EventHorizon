const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    permissions: [{
      type: String,
      enum: [
        'create_trigger',
        'read_trigger',
        'update_trigger',
        'delete_trigger',
        'manage_users',
        'manage_organization',
        'view_audit_logs',
      ],
    }],
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    isSystem: {
      type: Boolean,
      default: false, // System roles like owner, admin can't be deleted
    },
  },
  { timestamps: true }
);

// Ensure unique role names per organization
roleSchema.index({ name: 1, organization: 1 }, { unique: true });

module.exports = mongoose.model('Role', roleSchema);