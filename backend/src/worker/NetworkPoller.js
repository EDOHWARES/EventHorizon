const logger = require('../config/logger');
const Trigger = require('../models/trigger.model');
const { enqueueAction } = require('./queue');
const consulService = require('../services/consul.service');

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
        this.load = { activeTriggers: 0, lastPolled: null };
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        await consulService.registerPoller({
            name: 'poller',
            address: process.env.POLLER_HOST || '127.0.0.1',
            port: process.env.POLLER_PORT || 3000,
            tags: [this.networkName],
            meta: { network: this.networkName }
        });
        this.poll();
    }

    stop() {
        this.isRunning = false;
        if (this.timer) clearTimeout(this.timer);
        consulService.deregisterPoller();
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
            this.load.activeTriggers = activeTriggers.length;
            this.load.lastPolled = new Date().toISOString();
            await consulService.reportLoad(this.load);

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