"use strict";

/**
 * @file workflow.controller.js
 * @description Express controllers for the /api/workflows endpoints.
 */

const WorkflowService = require("../services/workflow.service");
const Trigger = require("../models/trigger.model");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/appError");

/**
 * POST /api/workflows
 * Start a new workflow execution for a trigger.
 *
 * Body: { triggerId, eventPayload }
 */
const startWorkflow = asyncHandler(async (req, res) => {
  const { triggerId, eventPayload } = req.body;

  if (!triggerId) throw new AppError("triggerId is required", 400);
  if (!eventPayload || typeof eventPayload !== "object") {
    throw new AppError("eventPayload must be a non-null object", 400);
  }

  const trigger = await Trigger.findOne({
    _id: triggerId,
    organization: req.user.organization,
  }).lean();

  if (!trigger) throw new AppError("Trigger not found", 404);
  if (!trigger.isActive) throw new AppError("Trigger is not active", 400);

  const result = await WorkflowService.startWorkflow(trigger, eventPayload);

  res.status(201).json({
    status: "success",
    data: result,
  });
});

/**
 * GET /api/workflows/:workflowId
 * Get live snapshot or persisted execution by workflowId.
 */
const getWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;

  // Try live actor first (fast path)
  const live = WorkflowService.getSnapshot(workflowId);
  if (live) {
    return res.json({ status: "success", data: { source: "live", ...live } });
  }

  // Fall back to DB
  const execution = await WorkflowService.getExecution(workflowId);
  if (!execution) throw new AppError("Workflow execution not found", 404);

  res.json({ status: "success", data: { source: "db", ...execution } });
});

/**
 * GET /api/workflows/trigger/:triggerId
 * Get execution history for a trigger.
 */
const getWorkflowHistory = asyncHandler(async (req, res) => {
  const { triggerId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip = parseInt(req.query.skip) || 0;

  // Ensure the trigger belongs to the caller's org
  const trigger = await Trigger.findOne({
    _id: triggerId,
    organization: req.user.organization,
  }).lean();
  if (!trigger) throw new AppError("Trigger not found", 404);

  const executions = await WorkflowService.getExecutionHistory(triggerId, {
    limit,
    skip,
  });

  res.json({
    status: "success",
    results: executions.length,
    data: executions,
  });
});

/**
 * POST /api/workflows/:workflowId/event
 * Deliver EVENT_RECEIVED to a pending workflow.
 */
const sendWorkflowEvent = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const result = WorkflowService.sendEvent(workflowId, req.body);
  if (!result) throw new AppError("No live workflow found with that ID", 404);
  res.json({ status: "success", data: result });
});

/**
 * DELETE /api/workflows/:workflowId
 * Cancel a pending workflow.
 */
const cancelWorkflow = asyncHandler(async (req, res) => {
  const { workflowId } = req.params;
  const cancelled = WorkflowService.cancelWorkflow(workflowId);
  if (!cancelled) {
    throw new AppError("Workflow not found or not in a cancellable state", 400);
  }
  res.json({ status: "success", message: "Workflow cancelled" });
});

module.exports = {
  startWorkflow,
  getWorkflow,
  getWorkflowHistory,
  sendWorkflowEvent,
  cancelWorkflow,
};
