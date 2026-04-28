const express = require('express');
const router = express.Router();
const rotationController = require('../controllers/rotation.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.use(authMiddleware);

/**
 * @openapi
 * /api/credentials/{id}/rotation-policy:
 *   get:
 *     summary: Get rotation policy for a credential
 *     tags: [Credentials, Rotation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rotation policy
 *       404:
 *         description: Not found
 *   post:
 *     summary: Create or update rotation policy
 *     tags: [Credentials, Rotation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [intervalHours]
 *             properties:
 *               intervalHours:
 *                 type: integer
 *                 minimum: 1
 *                 description: Rotation interval in hours
 *     responses:
 *       200:
 *         description: Policy created/updated
 *   delete:
 *     summary: Delete rotation policy
 *     tags: [Credentials, Rotation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Policy deleted
 */
router.route('/:id/rotation-policy')
    .get(rotationController.getPolicy)
    .post(rotationController.upsertPolicy)
    .delete(rotationController.deletePolicy);

/**
 * @openapi
 * /api/credentials/{id}/rotate:
 *   post:
 *     summary: Manually rotate a credential's secret
 *     tags: [Credentials, Rotation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Credential rotated
 */
router.post('/:id/rotate', rotationController.rotateNow);

/**
 * @openapi
 * /api/credentials/rotate/process:
 *   post:
 *     summary: Process all due credential rotations (admin/cron)
 *     tags: [Credentials, Rotation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rotation results
 */
router.post('/rotate/process', rotationController.processDue);

module.exports = router;
