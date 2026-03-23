const express = require('express');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Trigger:
 *       type: object
 *       required:
 *         - contractId
 *         - eventName
 *         - actionUrl
 *       properties:
 *         _id:
 *           type: string
 *           description: MongoDB identifier for the trigger.
 *           example: 65b2d7d0844db6b9b17a9ef1
 *         contractId:
 *           type: string
 *           description: Soroban contract identifier to monitor.
 *           example: CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *         eventName:
 *           type: string
 *           description: Event name emitted by the contract.
 *           example: SwapExecuted
 *         actionType:
 *           type: string
 *           enum:
 *             - webhook
 *             - discord
 *             - email
 *           default: webhook
 *           example: webhook
 *         actionUrl:
 *           type: string
 *           format: uri
 *           description: Destination URL or integration endpoint for the action.
 *           example: https://example.com/webhooks/event-horizon
 *         isActive:
 *           type: boolean
 *           default: true
 *           example: true
 *         lastPolledLedger:
 *           type: integer
 *           default: 0
 *           example: 0
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     TriggerInput:
 *       type: object
 *       required:
 *         - contractId
 *         - eventName
 *         - actionUrl
 *       properties:
 *         contractId:
 *           type: string
 *           example: CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *         eventName:
 *           type: string
 *           example: SwapExecuted
 *         actionType:
 *           type: string
 *           enum:
 *             - webhook
 *             - discord
 *             - email
 *           default: webhook
 *           example: webhook
 *         actionUrl:
 *           type: string
 *           format: uri
 *           example: https://example.com/webhooks/event-horizon
 *         isActive:
 *           type: boolean
 *           default: true
 *           example: true
 *     AuthCredentials:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: developer@eventhorizon.dev
 *         password:
 *           type: string
 *           format: password
 *           example: super-secret-password
 *     AuthTokenResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *           description: Bearer token returned after successful authentication.
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.signature
 *         expiresIn:
 *           type: integer
 *           description: Lifetime of the token in seconds.
 *           example: 3600
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           example: Validation failed
 */

const swaggerSpec = swaggerJsdoc({
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'EventHorizon API',
            version: '1.0.0',
            description: 'Interactive API documentation for the EventHorizon backend.',
        },
        servers: [
            {
                url: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
                description: 'Local development server',
            },
        ],
        tags: [
            {
                name: 'Health',
                description: 'Operational endpoints for checking API availability.',
            },
            {
                name: 'Triggers',
                description: 'Manage Soroban event triggers and downstream actions.',
            },
            {
                name: 'Auth',
                description: 'Shared authentication request and response schemas for future auth endpoints.',
            },
        ],
    },
    apis: [
        path.join(__dirname, '../server.js'),
        path.join(__dirname, './*.js'),
    ],
});

router.get('/openapi.json', (req, res) => {
    res.json(swaggerSpec);
});

router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'EventHorizon API Docs',
}));

module.exports = router;