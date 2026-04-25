const express = require('express');
const router = express.Router();
const triggerController = require('../controllers/trigger.controller');
const auditMiddleware = require('../middleware/audit.middleware');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');
const {
    validateBody,
    validationSchemas,
} = require('../middleware/validation.middleware');

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
router.post(
    '/',
    authMiddleware,
    permissionMiddleware('create_trigger'),
    auditMiddleware.auditCreate(),
    validateBody(validationSchemas.triggerCreate),
    triggerController.createTrigger
);
router.get('/',
    authMiddleware,
    permissionMiddleware('read_trigger'),
    triggerController.getTriggers
);

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
router.delete('/:id',
    authMiddleware,
    permissionMiddleware('delete_trigger'),
    auditMiddleware.auditDelete(),
    triggerController.deleteTrigger
);

/**
 * @openapi
 * /api/triggers/{id}:
 *   put:
 *     summary: Update a trigger
 *     description: Update an existing trigger configuration including batching settings.
 *     tags:
 *       - Triggers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Trigger identifier.
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TriggerInput'
 *     responses:
 *       200:
 *         description: Trigger updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Trigger'
 *       404:
 *         description: Trigger not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       400:
 *         description: Invalid trigger payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/:id',
    authMiddleware,
    permissionMiddleware('update_trigger'),
    auditMiddleware.auditUpdate(),
    triggerController.updateTrigger
);

/**
 * @openapi
 * /api/triggers/{id}/versions:
 *   get:
 *     summary: List trigger versions
 *     description: Return all versions of a trigger.
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
 *       200:
 *         description: List of trigger versions.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TriggerVersion'
 */
router.get('/:id/versions', triggerController.getTriggerVersions);

/**
 * @openapi
 * /api/triggers/{id}/versions/{version}/restore:
 *   post:
 *     summary: Restore a trigger version
 *     description: Restore a trigger to a specific version.
 *     tags:
 *       - Triggers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Trigger identifier.
 *         schema:
 *           type: string
 *       - in: path
 *         name: version
 *         required: true
 *         description: Version number.
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Trigger restored successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Trigger'
 */
router.post('/:id/versions/:version/restore', triggerController.restoreTriggerVersion);

module.exports = router;
