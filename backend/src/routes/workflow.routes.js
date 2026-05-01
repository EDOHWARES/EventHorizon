"use strict";

const express = require("express");
const router = express.Router();
const workflowController = require("../controllers/workflow.controller");
const authMiddleware = require("../middleware/auth.middleware");
const permissionMiddleware = require("../middleware/permission.middleware");
const {
  validateBody,
  validationSchemas,
} = require("../middleware/validation.middleware");

/**
 * @openapi
 * /api/workflows:
 *   post:
 *     summary: Start a workflow execution
 *     description: >
 *       Spawns an XState workflow actor for the specified trigger and event payload.
 *       The actor progresses through idle → validating → pending → executing → completed|failed.
 *     tags:
 *       - Workflows
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - triggerId
 *               - eventPayload
 *             properties:
 *               triggerId:
 *                 type: string
 *                 description: Mongoose ObjectId of the Trigger document.
 *               eventPayload:
 *                 type: object
 *                 description: Raw Soroban event data to process.
 *     responses:
 *       201:
 *         description: Workflow started successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkflowSnapshot'
 *       400:
 *         description: Invalid request body or inactive trigger.
 *       404:
 *         description: Trigger not found.
 */
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("create_trigger"),
  workflowController.startWorkflow
);

/**
 * @openapi
 * /api/workflows/{workflowId}:
 *   get:
 *     summary: Get workflow execution state
 *     description: Returns the current state and context of a workflow. Checks live actors first, then the database.
 *     tags:
 *       - Workflows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workflow snapshot.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkflowSnapshot'
 *       404:
 *         description: Workflow not found.
 */
router.get(
  "/:workflowId",
  authMiddleware,
  permissionMiddleware("read_trigger"),
  workflowController.getWorkflow
);

/**
 * @openapi
 * /api/workflows/trigger/{triggerId}:
 *   get:
 *     summary: Get workflow execution history for a trigger
 *     tags:
 *       - Workflows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: triggerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of workflow executions.
 */
router.get(
  "/trigger/:triggerId",
  authMiddleware,
  permissionMiddleware("read_trigger"),
  workflowController.getWorkflowHistory
);

/**
 * @openapi
 * /api/workflows/{workflowId}/event:
 *   post:
 *     summary: Deliver an event to a pending workflow
 *     description: Sends EVENT_RECEIVED to advance a workflow from `pending` to `executing`.
 *     tags:
 *       - Workflows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Event delivered; returns updated state.
 *       404:
 *         description: No live workflow found.
 */
router.post(
  "/:workflowId/event",
  authMiddleware,
  permissionMiddleware("update_trigger"),
  workflowController.sendWorkflowEvent
);

/**
 * @openapi
 * /api/workflows/{workflowId}:
 *   delete:
 *     summary: Cancel a pending workflow
 *     tags:
 *       - Workflows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workflow cancelled.
 *       400:
 *         description: Workflow not cancellable.
 */
router.delete(
  "/:workflowId",
  authMiddleware,
  permissionMiddleware("delete_trigger"),
  workflowController.cancelWorkflow
);

module.exports = router;
