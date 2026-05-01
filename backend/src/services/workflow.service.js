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
