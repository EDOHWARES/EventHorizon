const NetworkPoller = require('./NetworkPoller');
const networks = require('../config/networks');
const logger = require('../config/logger');
const consulService = require('../services/consul.service');

class PollerManager {
    constructor() {
        this.pollers = new Map();
    }

    async assignPollerForEvent(eventRequest) {
        // Discover pollers and their loads
        const pollers = await consulService.discoverPollers();
        const loads = await consulService.getPollerLoads();
        // Filter healthy pollers
        const healthyPollers = pollers.filter(p => p.ServiceChecks.every(c => c.Status === 'passing'));
        // Find poller with lowest load
        let selected = null;
        let minLoad = Infinity;
        for (const poller of healthyPollers) {
            const load = loads[poller.ServiceID]?.activeTriggers || 0;
            if (load < minLoad) {
                minLoad = load;
                selected = poller;
            }
        }
        return selected;
    }

    startAll() {
        logger.info('Initializing multi-network pollers...');
        for (const [networkName, config] of Object.entries(networks)) {
            if (config.rpcUrl) {
                const poller = new NetworkPoller(networkName, config);
                this.pollers.set(networkName, poller);
                poller.start();
            }
        }
    }

    stopAll() {
        logger.info('Stopping all network pollers...');
        for (const poller of this.pollers.values()) {
            poller.stop();
        }
    }
}

module.exports = new PollerManager();