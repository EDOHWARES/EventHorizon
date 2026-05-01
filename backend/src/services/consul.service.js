// ConsulService.js
// Handles registration, discovery, health checks, and load reporting for pollers using Consul

const Consul = require('consul');
const os = require('os');

class ConsulService {
    constructor() {
        this.consul = new Consul({
            host: process.env.CONSUL_HOST || '127.0.0.1',
            port: process.env.CONSUL_PORT || '8500',
            promisify: true
        });
        this.serviceId = `poller-${os.hostname()}-${process.pid}`;
    }

    async registerPoller({ name, address, port, tags = [], meta = {} }) {
        await this.consul.agent.service.register({
            id: this.serviceId,
            name,
            address,
            port,
            tags,
            meta,
            check: {
                http: `http://${address}:${port}/health`,
                interval: '10s',
                timeout: '5s'
            }
        });
    }

    async deregisterPoller() {
        await this.consul.agent.service.deregister(this.serviceId);
    }

    async discoverPollers() {
        const services = await this.consul.catalog.service.nodes('poller');
        return services;
    }

    async reportLoad(load) {
        // Store load in Consul KV store for this poller
        await this.consul.kv.set(`poller/${this.serviceId}/load`, JSON.stringify(load));
    }

    async getPollerLoads() {
        const keys = await this.consul.kv.keys('poller/');
        const loads = {};
        for (const key of keys.filter(k => k.endsWith('/load'))) {
            const data = await this.consul.kv.get(key);
            loads[key.split('/')[1]] = JSON.parse(data.Value);
        }
        return loads;
    }
}

module.exports = new ConsulService();
