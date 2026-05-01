const express = require('express');
const router = express.Router();
const breakers = require('../services/circuitBreaker');

/**
 * @openapi
 * /api/health/circuit-breakers:
 *   get:
 *     summary: Circuit breaker status
 *     description: |
 *       Returns the current state (CLOSED, OPEN, HALF_OPEN) and rolling
 *       statistics for every outward-call circuit breaker registered in the
 *       process. Used by operators to detect 'poison pill' downstream
 *       endpoints that have tripped their breaker.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Map of breaker key to state and statistics.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 circuitBreakers:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       state:
 *                         type: string
 *                         enum: [CLOSED, OPEN, HALF_OPEN]
 *                       stats:
 *                         type: object
 *                       config:
 *                         type: object
 */
router.get('/circuit-breakers', (_req, res) => {
    res.json({ circuitBreakers: breakers.getStatus() });
});

module.exports = router;
