const express = require('express');
const cors = require('cors');
const {
    globalRateLimiter,
    authRateLimiter,
} = require('./middleware/rateLimit.middleware');
const {
    requestLogger,
    errorLogger,
} = require('./middleware/logging.middleware');
const {
    errorHandler,
    notFoundHandler,
} = require('./middleware/error.middleware');

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(globalRateLimiter);
app.use('/api/auth', authRateLimiter);

app.use('/api/docs', require('./routes/docs.routes'));
app.use('/api/triggers', require('./routes/trigger.routes'));
app.use('/api/invitations', require('./routes/invitation.routes'));
app.use('/api/admin/ip-whitelist', require('./routes/ipWhitelist.routes'));
// app.use('/api/team', require('./routes/team.routes'));
app.use('/api/queue', require('./routes/queue.routes'));
app.use('/api/discovery', require('./routes/discovery.routes'));
app.use('/api/escrow', require('./routes/escrow.routes'));
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/health', require('./routes/health.routes'));

app.use(errorLogger);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
