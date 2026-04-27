const express = require('express');
const router = express.Router();
const invitationController = require('../controllers/invitation.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');
const {
    validateBody,
    validationSchemas,
} = require('../middleware/validation.middleware');

/**
 * @openapi
 * /api/invitations:
 *   post:
 *     summary: Invite user to organization
 *     tags:
 *       - Invitations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               roleId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Invitation sent
 */
router.post(
    '/',
    authMiddleware,
    permissionMiddleware('manage_users'),
    validateBody(validationSchemas.inviteUser),
    invitationController.inviteUser
);

/**
 * @openapi
 * /api/invitations:
 *   get:
 *     summary: Get organization invitations
 *     tags:
 *       - Invitations
 *     responses:
 *       200:
 *         description: List of invitations
 */
router.get(
    '/',
    authMiddleware,
    permissionMiddleware('manage_users'),
    invitationController.getInvitations
);

/**
 * @openapi
 * /api/invitations/{id}/cancel:
 *   post:
 *     summary: Cancel invitation
 *     tags:
 *       - Invitations
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitation cancelled
 */
router.post(
    '/:id/cancel',
    authMiddleware,
    permissionMiddleware('manage_users'),
    invitationController.cancelInvitation
);

/**
 * @openapi
 * /api/invitations/accept:
 *   post:
 *     summary: Accept invitation
 *     tags:
 *       - Invitations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitation accepted
 */
router.post('/accept',
    validateBody(validationSchemas.acceptInvitation),
    invitationController.acceptInvitation
);

module.exports = router;