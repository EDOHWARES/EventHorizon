const express = require('express');
const router = express.Router();
const discoveryController = require('../controllers/discovery.controller');

/**
 * @openapi
 * /api/discovery/search:
 *   get:
 *     summary: Search for contracts
 *     tags: [Discovery]
 *     parameters:
 *       - in: query
 *         name: pattern
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of discovered contracts
 */
router.get('/search', discoveryController.getDiscoveredContracts);

/**
 * @openapi
 * /api/discovery/suggestions/:vaultId:
 *   get:
 *     summary: Get strategy suggestions for a vault
 *     tags: [Discovery]
 *     parameters:
 *       - in: path
 *         name: vaultId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of suggested strategies
 */
router.get('/suggestions/:vaultId', discoveryController.getStrategySuggestions);

/**
 * @openapi
 * /api/discovery/assign-poller:
 *   post:
 *     summary: Assign a poller for an event request
 *     tags: [Discovery]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Assigned poller
 */
router.post('/assign-poller', discoveryController.assignPoller);

module.exports = router;
