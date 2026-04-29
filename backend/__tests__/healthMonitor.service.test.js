const test = require('node:test');
const assert = require('node:assert');
const healthMonitorService = require('../src/services/healthMonitor.service');
const mongoose = require('mongoose');
const pagerdutyService = require('../src/services/pagerduty.service');

test('HealthMonitorService', async (t) => {
    let triggeredIncidents = [];
    let resolvedIncidents = [];

    // Mock PagerDuty
    const originalTrigger = pagerdutyService.triggerIncident;
    const originalResolve = pagerdutyService.resolveIncident;

    t.beforeEach(() => {
        triggeredIncidents = [];
        resolvedIncidents = [];
        
        pagerdutyService.triggerIncident = async (title, source, details, dedupKey) => {
            triggeredIncidents.push(dedupKey);
        };
        pagerdutyService.resolveIncident = async (dedupKey) => {
            resolvedIncidents.push(dedupKey);
        };
    });

    t.afterEach(() => {
        pagerdutyService.triggerIncident = originalTrigger;
        pagerdutyService.resolveIncident = originalResolve;
        // reset status
        healthMonitorService.status.database = true;
        healthMonitorService.status.worker = true;
    });

    await t.test('checkDatabaseHealth() triggers incident when connection lost', async () => {
        const originalReadyState = mongoose.connection.readyState;
        
        // simulate disconnected (readyState 0)
        Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
        
        await healthMonitorService.checkDatabaseHealth();
        assert.strictEqual(healthMonitorService.status.database, false);
        assert.strictEqual(triggeredIncidents.length, 1);
        assert.strictEqual(triggeredIncidents[0], healthMonitorService.DEDUP_KEYS.database);

        // check again, shouldn't re-trigger
        await healthMonitorService.checkDatabaseHealth();
        assert.strictEqual(triggeredIncidents.length, 1);

        // simulate reconnected (readyState 1)
        Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
        await healthMonitorService.checkDatabaseHealth();
        assert.strictEqual(healthMonitorService.status.database, true);
        assert.strictEqual(resolvedIncidents.length, 1);
        assert.strictEqual(resolvedIncidents[0], healthMonitorService.DEDUP_KEYS.database);

        Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, configurable: true });
    });

    await t.test('checkWorkerHealth() triggers incident when worker errors', async () => {
        // Need to mock require for pollerState or manipulate require cache,
        // but easier to test that if an error is thrown, it considers worker unhealthy.
        // We can do this by deleting it from require cache and replacing it.
        const pollerPath = require.resolve('../src/worker/pollerState');
        const originalPoller = require.cache[pollerPath];

        require.cache[pollerPath] = {
            id: pollerPath,
            filename: pollerPath,
            loaded: true,
            exports: {
                getState: () => ({ isPolling: false, lastError: 'Some error' })
            }
        };

        await healthMonitorService.checkWorkerHealth();
        assert.strictEqual(healthMonitorService.status.worker, false);
        assert.strictEqual(triggeredIncidents.length, 1);
        assert.strictEqual(triggeredIncidents[0], healthMonitorService.DEDUP_KEYS.worker);

        // Now healthy
        require.cache[pollerPath].exports.getState = () => ({ isPolling: true });
        await healthMonitorService.checkWorkerHealth();
        assert.strictEqual(healthMonitorService.status.worker, true);
        assert.strictEqual(resolvedIncidents.length, 1);
        assert.strictEqual(resolvedIncidents[0], healthMonitorService.DEDUP_KEYS.worker);

        // Restore
        if (originalPoller) {
            require.cache[pollerPath] = originalPoller;
        } else {
            delete require.cache[pollerPath];
        }
    });
});
