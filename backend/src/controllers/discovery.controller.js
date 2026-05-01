const discoveryService = require('../services/discovery.service');

const getDiscoveredContracts = async (req, res, next) => {
    try {
        const { pattern } = req.query;
        const contracts = await discoveryService.discoverContracts(pattern);
        res.json({
            success: true,
            data: contracts
        });
    } catch (error) {
        next(error);
    }
};

const getStrategySuggestions = async (req, res, next) => {
    try {
        const { vaultId } = req.params;
        const suggestions = await discoveryService.suggestStrategies(vaultId);
        res.json({
            success: true,
            data: suggestions
        });
    } catch (error) {
        next(error);
    }
};

const assignPoller = async (req, res, next) => {
    try {
        const eventRequest = req.body;
        const poller = await discoveryService.assignPoller(eventRequest);
        res.json({ success: true, poller });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDiscoveredContracts,
    getStrategySuggestions,
    assignPoller
};
