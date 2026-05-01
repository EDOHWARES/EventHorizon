const killSwitchService = require('../services/killSwitch.service');

/**
 * Get the current kill switch status
 * @route GET /api/kill-switch
 * @access Private (super-admin only)
 */
async function getKillSwitchStatus(req, res) {
  try {
    const status = await killSwitchService.getKillSwitchStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting kill switch status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update the kill switch configuration
 * @route PUT /api/kill-switch
 * @access Private (super-admin only)
 */
async function updateKillSwitch(req, res) {
  try {
    const { global, perOrganization, perProvider } = req.body;
    const updatedBy = req.user.id;

    const updates = {};
    if (typeof global === 'boolean') updates.global = global;
    if (perOrganization) updates.perOrganization = perOrganization;
    if (perProvider) updates.perProvider = perProvider;

    const killSwitch = await killSwitchService.updateKillSwitch(updates, updatedBy);
    res.json(killSwitch);
  } catch (error) {
    console.error('Error updating kill switch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getKillSwitchStatus,
  updateKillSwitch,
};