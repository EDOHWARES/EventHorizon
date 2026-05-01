const {
    recordActionSuccess,
    recordActionFailure,
    recordQueueLatency,
    register
} = require('./exporter');

describe('Prometheus Exporter', () => {
    beforeEach(() => {
        register.resetMetrics();
    });

    test('should record successful actions', async () => {
        recordActionSuccess('webhook');
        const metrics = await register.metrics();
        
        expect(metrics).toContain('eventhorizon_action_status_total');
        expect(metrics).toContain('status="success"');
        expect(metrics).toContain('action_type="webhook"');
    });

    test('should record failed actions', async () => {
        recordActionFailure('contract_invoke');
        const metrics = await register.metrics();
        
        expect(metrics).toContain('eventhorizon_action_status_total');
        expect(metrics).toContain('status="failure"');
        expect(metrics).toContain('action_type="contract_invoke"');
    });

    test('should record queue latency', async () => {
        recordQueueLatency(1.5);
        const metrics = await register.metrics();
        
        expect(metrics).toContain('eventhorizon_queue_latency_seconds_bucket');
        expect(metrics).toMatch(/eventhorizon_queue_latency_seconds_bucket\{le="2"\}\s+1/);
    });
});