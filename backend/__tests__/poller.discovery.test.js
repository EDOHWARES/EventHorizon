const request = require('supertest');
const express = require('express');
const discoveryRoutes = require('../src/routes/discovery.routes');

const app = express();
app.use(express.json());
app.use('/api/discovery', discoveryRoutes);

describe('Poller Service Discovery and Orchestration', () => {
    it('should assign a poller for an event request', async () => {
        const res = await request(app)
            .post('/api/discovery/assign-poller')
            .send({ eventType: 'Deposit', network: 'testnet' });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.poller).toBeDefined();
    });
});
