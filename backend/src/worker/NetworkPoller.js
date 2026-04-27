const logger = require('../config/logger');
const Trigger = require('../models/trigger.model');
const { enqueueAction } = require('./queue');

/**
 * Class responsible for polling a specific Stellar network for Soroban events.
 */
class NetworkPoller {
    constructor(networkName, config) {
        this.networkName = networkName;
        this.rpcUrl = config.rpcUrl;
        this.passphrase = config.passphrase;
        this.isRunning = false;
        this.timer = null;
        this.pollInterval = 5000;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info(`Starting poller for network: ${this.networkName} at ${this.rpcUrl}`);
        this.poll();
    }

    stop() {
        this.isRunning = false;
        if (this.timer) clearTimeout(this.timer);
        logger.info(`Stopped poller for network: ${this.networkName}`);
    }

    async poll() {
        if (!this.isRunning) return;

        try {
            // Fetch active triggers specifically targeting this network pool
            const activeTriggers = await Trigger.find({ 
                isActive: true, 
                network: this.networkName 
            });

            // TODO: Execute getEvents via Soroban RPC client mapped to this.rpcUrl here.
            // Then, pass matches via `await enqueueAction(trigger, event)` mapping correctly.
            
        } catch (error) {
            logger.error(`Error polling network ${this.networkName}`, { error: error.message });
        } finally {
            if (this.isRunning) {
                this.timer = setTimeout(() => this.poll(), this.pollInterval);
            }
        }
    }
}

module.exports = NetworkPoller;