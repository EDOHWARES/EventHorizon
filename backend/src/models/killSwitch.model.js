const mongoose = require('mongoose');

const killSwitchSchema = new mongoose.Schema(
  {
    global: {
      type: Boolean,
      default: false,
    },
    perOrganization: {
      type: Map,
      of: Boolean,
      default: {},
    },
    perProvider: {
      type: Map,
      of: Boolean,
      default: {},
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Ensure only one document exists
killSwitchSchema.index({}, { unique: true, sparse: true });

module.exports = mongoose.model('KillSwitch', killSwitchSchema);