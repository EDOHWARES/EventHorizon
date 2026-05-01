"use strict";

/**
 * @file workflowExecution.model.js
 * @description Persists XState workflow snapshots so execution progress
 * survives process restarts and can be queried by the dashboard.
 */

const mongoose = require("mongoose");

const WORKFLOW_STATES = [
  "idle",
  "validating",
  "pending",
  "executing",
  "retrying",
  "completed",
  "failed",
];

const workflowExecutionSchema = new mongoose.Schema(
  {
    workflowId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    triggerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trigger",
      required: true,
      index: true,
    },
    /** Current XState state value */
    state: {
      type: String,
      enum: WORKFLOW_STATES,
      required: true,
    },
    /** Full XState context snapshot */
    context: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    /**
     * XState actor status:
     * 'active' | 'done' | 'error' | 'stopped'
     */
    status: {
      type: String,
      default: "active",
    },
    /** Validation errors captured during the `validating` state */
    validationErrors: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── virtuals ──────────────────────────────────────────────────────────────────

workflowExecutionSchema.virtual("isTerminal").get(function () {
  return this.state === "completed" || this.state === "failed";
});

workflowExecutionSchema.virtual("durationMs").get(function () {
  if (!this.context?.startedAt) return null;
  const end = this.context?.completedAt
    ? new Date(this.context.completedAt)
    : new Date();
  return end - new Date(this.context.startedAt);
});

// ── indexes ───────────────────────────────────────────────────────────────────

workflowExecutionSchema.index({ triggerId: 1, createdAt: -1 });
workflowExecutionSchema.index({ state: 1 });

const WorkflowExecution = mongoose.model(
  "WorkflowExecution",
  workflowExecutionSchema
);

module.exports = WorkflowExecution;
module.exports.WORKFLOW_STATES = WORKFLOW_STATES;
