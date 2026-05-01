const express = require('express');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const Converter = require('openapi-to-postmanv2');

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
 *             - telegram
 *           default: webhook
 *           example: webhook
 *         actionUrl:
 *           type: string
 *           format: uri
 *           description: Destination URL or integration endpoint for the action.
 *           example: https://example.com/webhooks/event-horizon
 *         steps:
 *           type: array
 *           description: Ordered workflow steps. When present, top-level actionUrl is not used.
 *           items:
 *             $ref: '#/components/schemas/WorkflowStep'
 *         workflowConfig:
 *           $ref: '#/components/schemas/WorkflowConfig'
 *         isActive:
 *           type: boolean
 *           default: true
 *           example: true
 *         authConfig:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               enum: [none, oauth2]
 *               default: none
 *             oauth2:
 *               type: object
 *               properties:
 *                 tokenUrl:
 *                   type: string
 *                   format: uri
 *                 clientId:
 *                   type: string
 *                 clientSecret:
 *                   type: string
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
 *             - telegram
 *           default: webhook
 *           example: webhook
 *         actionUrl:
 *           type: string
 *           format: uri
 *           example: https://example.com/webhooks/event-horizon
 *         steps:
 *           type: array
 *           description: Ordered workflow steps. Omit actionUrl when steps are provided.
 *           items:
 *             $ref: '#/components/schemas/WorkflowStep'
 *         workflowConfig:
 *           $ref: '#/components/schemas/WorkflowConfig'
 *         isActive:
 *           type: boolean
 *           default: true
 *           example: true
 *     WorkflowStep:
 *       type: object
 *       required:
 *         - id
 *         - actionType
 *       properties:
 *         id:
 *           type: string
 *           pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
 *           example: notifyWebhook
 *         name:
 *           type: string
 *           example: Notify partner webhook
 *         actionType:
 *           type: string
 *           enum:
 *             - webhook
 *             - discord
 *             - email
 *             - telegram
 *           example: webhook
 *         actionUrl:
 *           type: string
 *           format: uri
 *           example: https://example.com/workflow-step
 *         webhookSecret:
 *           type: string
 *           description: Optional per-step webhook signing secret.
 *         config:
 *           type: object
 *           additionalProperties: true
 *           description: Action-specific settings. String values may reference workflow context templates.
 *         runIf:
 *           type: string
 *           enum:
 *             - success
 *             - failure
 *             - always
 *           default: success
 *     WorkflowConfig:
 *       type: object
 *       properties:
 *         continueOnError:
 *           type: boolean
 *           default: false
 *           description: Return a failed workflow result instead of throwing after failed steps.
 *         authConfig:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               enum: [none, oauth2]
 *               default: none
 *             oauth2:
 *               type: object
 *               properties:
 *                 tokenUrl:
 *                   type: string
 *                   format: uri
 *                 clientId:
 *                   type: string
 *                 clientSecret:
 *                   type: string
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

let postmanCollection = null;

Converter.convert(
    { type: 'json', data: swaggerSpec },
    { folderStrategy: 'Tags', includeWebhooks: true },
    (err, conversionResult) => {
        if (err) {
            console.error('Error generating Postman collection:', err);
        } else if (!conversionResult.result) {
            console.error('Could not convert to Postman format:', conversionResult.reason);
        } else {
            postmanCollection = conversionResult.output[0].data;
            // Ensure pre-defined environment variables are included
            postmanCollection.variable = postmanCollection.variable || [];
            
            const hasAuth = postmanCollection.variable.find(v => v.key === 'AUTH_TOKEN');
            if (!hasAuth) {
                postmanCollection.variable.push({
                    key: 'AUTH_TOKEN',
                    value: '',
                    type: 'string',
                    description: 'Bearer token for authenticated requests'
                });
            }
            console.log('Postman collection successfully generated from Swagger annotations.');
        }
    }
);

router.get('/postman.json', (req, res) => {
    if (!postmanCollection) {
        return res.status(503).json({ error: 'Postman collection is still generating or failed to generate.' });
    }
    res.attachment('EventHorizon_Postman_Collection.json');
    res.json(postmanCollection);
});

router.get('/openapi.json', (req, res) => {
    res.json(swaggerSpec);
});

router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'EventHorizon API Docs',
}));

module.exports = router;
