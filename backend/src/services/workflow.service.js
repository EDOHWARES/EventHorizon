const crypto = require('crypto');
const { executeSingleAction } = require('./actionExecutor.service');
const logger = require('../config/logger');
const { resolveTemplates } = require('../utils/templater');

class WorkflowExecutionError extends Error {
    constructor(message, result) {
        super(message);
        this.name = 'WorkflowExecutionError';
        this.result = result;
    }
}

function generateRunId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function shouldRunStep(runIf, previousResult) {
    const condition = runIf || 'success';
    if (condition === 'always') return true;
    if (!previousResult) return condition === 'success';
    if (condition === 'success') return previousResult.success === true;
    if (condition === 'failure') return previousResult.success === false;
    return false;
}

function createContext(trigger, eventPayload, runId) {
    return {
        runId: runId || generateRunId(),
        event: eventPayload,
        trigger: {
            id: trigger._id,
            contractId: trigger.contractId,
            eventName: trigger.eventName,
            organization: trigger.organization,
        },
        steps: {},
        stepOrder: [],
        lastResult: null,
    };
}

function buildStepTrigger(trigger, step) {
    return {
        ...trigger,
        ...step,
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        organization: trigger.organization,
        webhookSecret: step.webhookSecret || step.config?.webhookSecret || trigger.webhookSecret,
    };
}

async function executeWorkflow(trigger, eventPayload, options = {}) {
    const steps = Array.isArray(trigger.steps) ? trigger.steps : [];
    if (steps.length === 0) {
        throw new Error('Workflow trigger requires at least one step');
    }

    const executor = options.executeStep || executeSingleAction;
    const context = createContext(trigger, eventPayload, options.runId);
    const continueOnError = trigger.workflowConfig?.continueOnError === true;
    let previousResult = null;
    let failed = false;

    for (const rawStep of steps) {
        const plainStep = typeof rawStep.toObject === 'function'
            ? rawStep.toObject({ depopulate: true })
            : rawStep;
        const step = resolveTemplates(plainStep, context);
        const startedAt = Date.now();

        if (!shouldRunStep(step.runIf, previousResult)) {
            const skipped = {
                id: step.id,
                actionType: step.actionType,
                success: false,
                skipped: true,
                output: null,
                error: `Skipped because runIf "${step.runIf || 'success'}" was not satisfied`,
                durationMs: 0,
            };
            context.steps[step.id] = skipped;
            context.stepOrder.push(step.id);
            context.lastResult = skipped;
            previousResult = skipped;
            continue;
        }

        try {
            const output = await executor(
                buildStepTrigger(trigger, step),
                eventPayload,
                { context, stepId: step.id }
            );
            const result = {
                id: step.id,
                actionType: step.actionType,
                success: true,
                skipped: false,
                output,
                error: null,
                durationMs: Date.now() - startedAt,
            };
            context.steps[step.id] = result;
            context.stepOrder.push(step.id);
            context.lastResult = result;
            previousResult = result;
        } catch (error) {
            failed = true;
            const result = {
                id: step.id,
                actionType: step.actionType,
                success: false,
                skipped: false,
                output: null,
                error: error.message,
                durationMs: Date.now() - startedAt,
            };
            context.steps[step.id] = result;
            context.stepOrder.push(step.id);
            context.lastResult = result;
            previousResult = result;

            logger.error('Workflow step failed', {
                runId: context.runId,
                stepId: step.id,
                actionType: step.actionType,
                error: error.message,
            });
        }
    }

    const result = {
        runId: context.runId,
        status: failed ? 'failed' : 'succeeded',
        context,
    };

    if (failed && !continueOnError) {
        throw new WorkflowExecutionError('Workflow execution failed', result);
    }

    return result;
}

module.exports = {
    WorkflowExecutionError,
    executeWorkflow,
    shouldRunStep,
};
"use strict";

/**
 * @file workflow.service.js
 * @description Manages lifecycle of XState workflow actors for EventHorizon.
 *
 * Responsibilities
 * ────────────────
 * • Spawn / rehydrate workflow actors from Trigger documents
 * • Persist execution snapshots to WorkflowExecution documents
 * • Expose progress-tracking helpers consumed by the REST layer
 */

const { createActor, waitFor } = require("xstate");
const { createWorkflowMachine, retryDelay } = require("./workflowMachine");
const WorkflowExecution = require("../models/workflowExecution.model");
const { v4: uuidv4 } =
  typeof require("crypto").randomUUID === "function"
    ? { v4: () => require("crypto").randomUUID() } // Node 14.17+
    : require("crypto"); // fallback — never reached on Node 18+

// ── in-memory actor registry (keyed by workflowId) ───────────────────────────
// In a clustered deployment replace this with a Redis-backed store.
const _liveActors = new Map();

// ── helpers ───────────────────────────────────────────────────────────────────

function workflowIdFromTrigger(triggerId) {
  return `${triggerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotToDoc(workflowId, triggerId, snapshot) {
  return {
    workflowId,
    triggerId,
    state: snapshot.value,
    context: snapshot.context,
    status: snapshot.status, // 'active' | 'done' | 'error' | 'stopped'
    updatedAt: new Date(),
  };
}

// ── service ───────────────────────────────────────────────────────────────────

const WorkflowService = {
  /**
   * Starts a new workflow execution for a given trigger + event payload.
   *
   * @param {object} trigger   – Mongoose Trigger document (plain object or lean)
   * @param {object} eventPayload – Raw Soroban event data
   * @param {object} [deps]    – Injectable dependencies (executeAction for testing)
   * @returns {Promise<{ workflowId: string, execution: object }>}
   */
  async startWorkflow(trigger, eventPayload, deps = {}) {
    const workflowId = workflowIdFromTrigger(String(trigger._id));

    const machine = createWorkflowMachine({
      executeAction: deps.executeAction,
    });

    const actor = createActor(machine, {
      input: {
        triggerId: String(trigger._id),
        workflowId,
        eventPayload,
        actionType: trigger.actionType,
        actionUrl: trigger.actionUrl,
        maxRetries: trigger.retryConfig?.maxRetries ?? 3,
      },
      delays: {
        // XState v5 resolves named delays via this map
        RETRY_DELAY: ({ context }) => retryDelay(context),
      },
    });

    // Persist every state transition
    actor.subscribe(async (snapshot) => {
      try {
        await WorkflowExecution.findOneAndUpdate(
          { workflowId },
          snapshotToDoc(workflowId, String(trigger._id), snapshot),
          { upsert: true, new: true }
        );
      } catch (err) {
        // Non-fatal — log and continue
        console.error(
          "[WorkflowService] Failed to persist snapshot:",
          err.message
        );
      }
    });

    _liveActors.set(workflowId, actor);
    actor.start();
    actor.send({ type: "START" });

    // Give validation a moment to complete before returning
    const snapshot = await waitFor(
      actor,
      (s) => s.value !== "idle" && s.value !== "validating",
      { timeout: 5_000 }
    ).catch(() => actor.getSnapshot());

    return { workflowId, state: snapshot.value, context: snapshot.context };
  },

  /**
   * Delivers an event to a live workflow actor (idle→pending→executing).
   *
   * @param {string} workflowId
   * @param {object} [extraPayload]
   * @returns {{ state: string, context: object } | null}
   */
  sendEvent(workflowId, extraPayload = {}) {
    const actor = _liveActors.get(workflowId);
    if (!actor) return null;

    actor.send({ type: "EVENT_RECEIVED", ...extraPayload });
    const snap = actor.getSnapshot();
    return { state: snap.value, context: snap.context };
  },

  /**
   * Returns current in-memory snapshot for a workflow.
   *
   * @param {string} workflowId
   * @returns {{ state: string, context: object } | null}
   */
  getSnapshot(workflowId) {
    const actor = _liveActors.get(workflowId);
    if (!actor) return null;
    const snap = actor.getSnapshot();
    return { state: snap.value, context: snap.context };
  },

  /**
   * Loads execution history from the database.
   *
   * @param {string} triggerId
   * @param {{ limit?: number, skip?: number }} [opts]
   * @returns {Promise<object[]>}
   */
  async getExecutionHistory(triggerId, opts = {}) {
    return WorkflowExecution.find({ triggerId })
      .sort({ updatedAt: -1 })
      .skip(opts.skip ?? 0)
      .limit(opts.limit ?? 20)
      .lean();
  },

  /**
   * Returns persisted execution document by workflowId.
   *
   * @param {string} workflowId
   * @returns {Promise<object|null>}
   */
  async getExecution(workflowId) {
    return WorkflowExecution.findOne({ workflowId }).lean();
  },

  /**
   * Cancels a live workflow that is in the `pending` state.
   *
   * @param {string} workflowId
   * @returns {boolean} true if the CANCEL event was dispatched
   */
  cancelWorkflow(workflowId) {
    const actor = _liveActors.get(workflowId);
    if (!actor) return false;
    const snap = actor.getSnapshot();
    if (snap.value !== "pending") return false;
    actor.send({ type: "CANCEL" });
    return true;
  },

  /** Exposed for testing — clear the live-actor registry. */
  _clearRegistry() {
    _liveActors.clear();
  },
};

module.exports = WorkflowService;
