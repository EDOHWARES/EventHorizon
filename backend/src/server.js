const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('./config/logger');
const app = require('./app');

const PORT = process.env.PORT || 5000;

// Middleware
const cors = require('cors');
const express = require('express');

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/docs', require('./routes/docs.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/triggers', require('./routes/trigger.routes'));
app.use('/api/admin/audit', require('./routes/audit.routes'));
app.use('/api/admin/ip-whitelist', require('./routes/ipWhitelist.routes'));

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Confirm that the API process is running and able to serve requests.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: API is healthy.
 */
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/health/poller', (req, res) => {
    try {
        const pollerState = require('./worker/pollerState');
        res.json({
            status: 'ok',
            poller: pollerState.getState()
        });
    } catch (e) {
        res.status(500).json({ status: 'error', error: e.message });
    }
});

// Database Connection
mongoose
    .connect(process.env.MONGO_URI)
    .then(async () => {
        logger.info('Connected to MongoDB', {
            database: 'MongoDB',
            status: 'connected',
            uri: process.env.MONGO_URI?.replace(/\/\/.*@/, '//***@'),
        });

        // Initialize Vault
        try {
            const vaultService = require('./services/vault.service');
            await vaultService.initialize();
        } catch (error) {
            logger.error('Vault initialization failed', { error: error.message });
        }

        let worker = null;

        try {
            const { createWorker } = require('./worker/processor');
            worker = createWorker();
            logger.info('BullMQ queue system enabled');
        } catch (error) {
            logger.warn('BullMQ worker initialization failed - queue system disabled', {
                error: error.message,
                note: 'Install and start Redis to enable background job processing',
            });
        }

        const eventPoller = require('./worker/poller');
        eventPoller.start();

        // Start data retention job
        const retentionService = require('./services/retention.service');
        setInterval(() => {
            retentionService.archiveOldLogs().catch(error => {
                logger.error('Data retention job failed', { error: error.message });
            });
        }, 24 * 60 * 60 * 1000); // Run daily

        app.listen(PORT, () => {
            logger.info('Server started successfully', {
                port: PORT,
                environment: process.env.NODE_ENV || 'development',
                pid: process.pid,
                queueEnabled: worker !== null,
            });
        });

        process.on('SIGTERM', async () => {
            logger.info('SIGTERM received, shutting down gracefully');

            // Flush any pending batches before shutdown
            try {
                const batchService = require('./services/batch.service');
                batchService.flushAll();
                logger.info('Pending batches flushed');
            } catch (error) {
                logger.error('Error flushing batches during shutdown', { error: error.message });
            }

            if (worker) {
                await worker.close();
            }

            await mongoose.connection.close();
            process.exit(0);
        });
    })
    .catch((err) => {
        logger.error('MongoDB connection failed, starting server without DB', {
            error: err.message,
            database: 'MongoDB',
        });

        // Start server even without DB for testing
        app.listen(PORT, () => {
            logger.warn('Server started without database connection', {
                port: PORT,
                environment: process.env.NODE_ENV || 'development',
                healthCheck: `http://localhost:${PORT}/api/health`,
            });
        });
    });
