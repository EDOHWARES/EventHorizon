const KillSwitch = require('../models/killSwitch.model');

/**
 * Check if actions are allowed for a given organization and provider
 * @param {string} organizationId - The organization ID
 * @param {string} provider - The action provider (e.g., 'webhook', 'telegram')
 * @returns {boolean} - True if actions are allowed, false if blocked by kill switch
 */
async function isActionAllowed(organizationId, provider) {
  try {
    const killSwitch = await KillSwitch.findOne();

    if (!killSwitch) {
      // No kill switch configured, allow actions
      return true;
    }

    // Check global kill switch
    if (killSwitch.global) {
      return false;
    }

    // Check per-organization kill switch
    if (killSwitch.perOrganization.get(organizationId)) {
      return false;
    }

    // Check per-provider kill switch
    if (killSwitch.perProvider.get(provider)) {
      return false;
    }

    return true;
  } catch (error) {
    // In case of error, allow actions to prevent blocking legitimate traffic
    console.error('Error checking kill switch:', error);
    return true;
  }
}

/**
 * Get the current kill switch status
 * @returns {object} - The kill switch configuration
 */
async function getKillSwitchStatus() {
  try {
    const killSwitch = await KillSwitch.findOne();
    return killSwitch || {
      global: false,
      perOrganization: {},
      perProvider: {},
    };
  } catch (error) {
    console.error('Error getting kill switch status:', error);
    throw error;
  }
}

/**
 * Update the kill switch configuration
 * @param {object} updates - The updates to apply
 * @param {string} updatedBy - The user ID making the update
 * @returns {object} - The updated kill switch
 */
async function updateKillSwitch(updates, updatedBy) {
  try {
    const killSwitch = await KillSwitch.findOneAndUpdate(
      {},
      { ...updates, updatedBy },
      { upsert: true, new: true }
    );
    return killSwitch;
  } catch (error) {
    console.error('Error updating kill switch:', error);
    throw error;
  }
}

module.exports = {
  isActionAllowed,
  getKillSwitchStatus,
  updateKillSwitch,
};