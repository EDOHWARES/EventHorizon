const NetworkPoller = require('./NetworkPoller');
const networks = require('../config/networks');
const logger = require('../config/logger');

class PollerManager {
    constructor() {
        this.pollers = new Map();
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