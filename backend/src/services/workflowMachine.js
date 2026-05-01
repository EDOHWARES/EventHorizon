"use strict";

/**
 * @file workflowMachine.js
 * @description XState v5 state machine for EventHorizon visual workflow execution.
 *
 * States
 * ──────
 * idle        → workflow defined, not yet started
 * validating  → schema / guard checks running
 * pending     → waiting for a Soroban event to arrive
 * executing   → action (webhook / discord / email / telegram) in flight
 * retrying    → transient back-off before re-attempting the action
 * completed   → action succeeded; terminal
 * failed      → unrecoverable failure; terminal
 *
 * Context fields
 * ──────────────
 * triggerId       {string}   – Mongoose ObjectId of the owning Trigger document
 * workflowId      {string}   – unique execution ID for this run
 * eventPayload    {object}   – the raw Soroban event data
 * actionType      {string}   – 'webhook' | 'discord' | 'email' | 'telegram'
 * actionUrl       {string}
 * retryCount      {number}
 * maxRetries      {number}
 * lastError       {string|null}
 * startedAt       {Date|null}
 * completedAt     {Date|null}
 * validationErrors {string[]}
 */

const { setup, assign, fromPromise } = require("xstate");

// ── validation helpers ────────────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set(["webhook", "discord", "email", "telegram"]);

/**
 * Validates a workflow context object and returns a list of error strings.
 * An empty array means valid.
 *
 * @param {object} ctx
 * @returns {string[]}
 */
function validateWorkflowContext(ctx) {
  const errors = [];

  if (!ctx.triggerId) errors.push("triggerId is required");
  if (!ctx.workflowId) errors.push("workflowId is required");
  if (!ctx.eventPayload || typeof ctx.eventPayload !== "object") {
    errors.push("eventPayload must be a non-null object");
  }
  if (!VALID_ACTION_TYPES.has(ctx.actionType)) {
    errors.push(
      `actionType must be one of: ${[...VALID_ACTION_TYPES].join(", ")}`
    );
  }
  if (!ctx.actionUrl || typeof ctx.actionUrl !== "string") {
    errors.push("actionUrl is required");
  }
  if (typeof ctx.maxRetries !== "number" || ctx.maxRetries < 0) {
    errors.push("maxRetries must be a non-negative number");
  }

  return errors;
}

// ── actor factories (injected so tests can stub them) ─────────────────────────

/**
 * Builds the XState actor that performs the actual action call.
 * In production this will be replaced via `workflowMachineFactory`.
 *
 * @param {object} ctx
 * @returns {Promise<{status: number}>}
 */
async function defaultExecuteAction(ctx) {
  // Real implementation delegates to the existing webhook/discord/etc. services.
  // This default is a no-op placeholder so the machine can be unit-tested
  // without live network calls.
  return { status: 200 };
}

// ── machine factory ───────────────────────────────────────────────────────────

/**
 * Creates a configured XState v5 workflow state machine.
 *
 * @param {{ executeAction?: (ctx: object) => Promise<any> }} [options]
 * @returns {import('xstate').StateMachine}
 */
function createWorkflowMachine(options = {}) {
  const executeActionImpl = options.executeAction ?? defaultExecuteAction;

  return setup({
    types: {
      context: /** @type {WorkflowContext} */ ({}),
      events: /** @type {WorkflowEvent} */ ({}),
    },

    actors: {
      validateActor: fromPromise(async ({ input }) => {
        const errors = validateWorkflowContext(input.ctx);
        if (errors.length > 0) throw new Error(errors.join("; "));
        return true;
      }),

      executeActor: fromPromise(async ({ input }) => {
        return executeActionImpl(input.ctx);
      }),
    },

    guards: {
      canRetry: ({ context }) => context.retryCount < context.maxRetries,
    },

    actions: {
      markStarted: assign({
        startedAt: () => new Date(),
      }),

      markCompleted: assign({
        completedAt: () => new Date(),
        lastError: null,
      }),

      recordError: assign({
        lastError: ({ event }) =>
          event.error?.message ?? String(event.error) ?? "Unknown error",
      }),

      incrementRetry: assign({
        retryCount: ({ context }) => context.retryCount + 1,
      }),

      setValidationErrors: assign({
        validationErrors: ({ event }) =>
          event.error?.message?.split("; ") ?? ["Validation failed"],
      }),
    },
  }).createMachine({
    id: "workflow",
    initial: "idle",

    context: ({ input }) => ({
      triggerId: input?.triggerId ?? "",
      workflowId: input?.workflowId ?? "",
      eventPayload: input?.eventPayload ?? {},
      actionType: input?.actionType ?? "webhook",
      actionUrl: input?.actionUrl ?? "",
      retryCount: 0,
      maxRetries: input?.maxRetries ?? 3,
      lastError: null,
      startedAt: null,
      completedAt: null,
      validationErrors: [],
    }),

    states: {
      // ── idle ──────────────────────────────────────────────────────────
      idle: {
        on: {
          START: {
            target: "validating",
            actions: "markStarted",
          },
        },
      },

      // ── validating ────────────────────────────────────────────────────
      validating: {
        invoke: {
          id: "validateActor",
          src: "validateActor",
          input: ({ context }) => ({ ctx: context }),
          onDone: { target: "pending" },
          onError: {
            target: "failed",
            actions: ["setValidationErrors", "recordError"],
          },
        },
      },

      // ── pending ───────────────────────────────────────────────────────
      pending: {
        on: {
          EVENT_RECEIVED: { target: "executing" },
          CANCEL: { target: "failed" },
        },
      },

      // ── executing ─────────────────────────────────────────────────────
      executing: {
        invoke: {
          id: "executeActor",
          src: "executeActor",
          input: ({ context }) => ({ ctx: context }),
          onDone: {
            target: "completed",
            actions: "markCompleted",
          },
          onError: [
            {
              guard: "canRetry",
              target: "retrying",
              actions: ["recordError", "incrementRetry"],
            },
            {
              target: "failed",
              actions: "recordError",
            },
          ],
        },
      },

      // ── retrying ──────────────────────────────────────────────────────
      retrying: {
        after: {
          // back-off: 2^retryCount * 1000 ms, capped at 30 s
          RETRY_DELAY: { target: "executing" },
        },
      },

      // ── completed (terminal) ──────────────────────────────────────────
      completed: {
        type: "final",
      },

      // ── failed (terminal) ─────────────────────────────────────────────
      failed: {
        type: "final",
      },
    },
  });
}

// ── delay resolver ─────────────────────────────────────────────────────────────

/**
 * Computes the retry back-off delay in ms for a given machine snapshot.
 * Used by the XState `after` delay (key must match 'RETRY_DELAY').
 *
 * @param {object} context
 * @returns {number}
 */
function retryDelay(context) {
  const base = Math.pow(2, context.retryCount) * 1000;
  return Math.min(base, 30_000);
}

module.exports = {
  createWorkflowMachine,
  validateWorkflowContext,
  retryDelay,
  VALID_ACTION_TYPES,
};
