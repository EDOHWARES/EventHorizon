const express = require('express');
const router = express.Router();
const triggerController = require('../controllers/trigger.controller');

/**
 * @openapi
 * /api/triggers:
 *   post:
 *     summary: Create a trigger
 *     description: Register a new Soroban event trigger and the action to execute when it fires.
 *     tags:
 *       - Triggers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TriggerInput'
 *     responses:
 *       201:
 *         description: Trigger created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Trigger'
 *       400:
 *         description: Invalid trigger payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   get:
 *     summary: List triggers
 *     description: Return all configured triggers.
 *     tags:
 *       - Triggers
 *     responses:
 *       200:
 *         description: List of triggers.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Trigger'
 *       500:
 *         description: Failed to fetch triggers.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', triggerController.createTrigger);
router.get('/', triggerController.getTriggers);

/**
 * @openapi
 * /api/triggers/{id}:
 *   delete:
 *     summary: Delete a trigger
 *     description: Remove an existing trigger by its MongoDB identifier.
 *     tags:
 *       - Triggers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Trigger identifier.
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Trigger deleted successfully.
 *       500:
 *         description: Failed to delete the trigger.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', triggerController.deleteTrigger);

module.exports = router;
