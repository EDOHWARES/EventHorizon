const { rpc, Transaction, xdr } = require('@stellar/stellar-sdk');
const Trigger = require('../models/trigger.model');
const axios = require('axios');
const logger = require('../config/logger');

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL);

async function pollEvents() {
    try {
        const triggers = await Trigger.find({ isActive: true });
        if (triggers.length === 0) return;

        for (const trigger of triggers) {
            logger.debug('Polling trigger', {
                triggerId: trigger._id?.toString(),
                eventName: trigger.eventName,
                contractId: trigger.contractId,
            });
            
            // Logic to poll Soroban Events
            // In a real scenario, we'd use getEvents with a startLedger
            // and filter by contractId and topics.
        }
    } catch (error) {
        logger.error('Error in poller', { error: error.message, stack: error.stack });
    }
}

function start() {
    setInterval(pollEvents, process.env.POLL_INTERVAL_MS || 10000);
    logger.info('Event poller worker started', {
        intervalMs: Number(process.env.POLL_INTERVAL_MS || 10000),
        rpcUrl: RPC_URL,
    });
}

module.exports = { start };
