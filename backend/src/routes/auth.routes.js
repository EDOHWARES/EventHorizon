const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const {
    validateBody,
    validationSchemas,
} = require('../middleware/validation.middleware');

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register new user and organization
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               organizationName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registration successful
 */
router.post('/register',
    validateBody(validationSchemas.register),
    authController.register
);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Admin login
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthCredentials'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokenResponse'
 */
router.post('/login',
    validateBody(validationSchemas.authCredentials),
    authController.login
);

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags:
 *       - Auth
 */
router.post('/refresh', authController.refreshToken);

module.exports = router;