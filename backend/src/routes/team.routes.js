const express = require('express');
const router = express.Router();
const teamController = require('../controllers/team.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');
const {
    validateBody,
    validationSchemas,
} = require('../middleware/validation.middleware');

/**
 * @openapi
 * /api/team/members:
 *   get:
 *     summary: Get team members
 *     tags:
 *       - Team
 *     responses:
 *       200:
 *         description: List of team members
 */
router.get(
    '/members',
    authMiddleware,
    permissionMiddleware('manage_users'),
    teamController.getTeamMembers
);

/**
 * @openapi
 * /api/team/members/{userId}/role:
 *   put:
 *     summary: Update user role
 *     tags:
 *       - Team
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               roleId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Role updated
 */
router.put(
    '/members/:userId/role',
    authMiddleware,
    permissionMiddleware('manage_users'),
    teamController.updateUserRole
);

/**
 * @openapi
 * /api/team/members/{userId}:
 *   delete:
 *     summary: Remove user from organization
 *     tags:
 *       - Team
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User removed
 */
router.delete(
    '/members/:userId',
    authMiddleware,
    permissionMiddleware('manage_users'),
    teamController.removeUser
);

/**
 * @openapi
 * /api/team/roles:
 *   get:
 *     summary: Get organization roles
 *     tags:
 *       - Team
 *     responses:
 *       200:
 *         description: List of roles
 */
router.get(
    '/roles',
    authMiddleware,
    permissionMiddleware('manage_users'),
    teamController.getRoles
);

/**
 * @openapi
 * /api/team/roles:
 *   post:
 *     summary: Create role
 *     tags:
 *       - Team
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Role created
 */
router.post(
    '/roles',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    validateBody(validationSchemas.createRole),
    teamController.createRole
);

/**
 * @openapi
 * /api/team/roles/{id}:
 *   put:
 *     summary: Update role
 *     tags:
 *       - Team
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
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Role updated
 */
router.put(
    '/roles/:id',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    teamController.updateRole
);

/**
 * @openapi
 * /api/team/roles/{id}:
 *   delete:
 *     summary: Delete role
 *     tags:
 *       - Team
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Role deleted
 */
router.delete(
    '/roles/:id',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    teamController.deleteRole
);

module.exports = router;