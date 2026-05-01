"use strict";

/**
 * Unit tests for workflowMachine.js
 * Run: node --test tests/unit/workflowMachine.test.js
 */

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createActor, waitFor } = require("xstate");

const {
  createWorkflowMachine,
  validateWorkflowContext,
  retryDelay,
  VALID_ACTION_TYPES,
} = require("../src/services/workflowMachine");

// ── helpers ───────────────────────────────────────────────────────────────────

function baseInput(overrides = {}) {
  return {
    triggerId: "507f1f77bcf86cd799439011",
    workflowId: "test-wf-001",
    eventPayload: { ledger: 1, data: "test" },
    actionType: "webhook",
    actionUrl: "https://example.com/hook",
    maxRetries: 2,
    ...overrides,
  };
}

function makeActor(input, executeAction) {
  const machine = createWorkflowMachine({ executeAction });
  return createActor(machine, { input });
}

// ── validateWorkflowContext ────────────────────────────────────────────────────

describe("validateWorkflowContext", () => {
  test("returns empty array for valid context", () => {
    const errors = validateWorkflowContext(baseInput());
    assert.deepEqual(errors, []);
  });

  test("requires triggerId", () => {
    const errors = validateWorkflowContext(baseInput({ triggerId: "" }));
    assert.ok(errors.some((e) => e.includes("triggerId")));
  });

  test("requires workflowId", () => {
    const errors = validateWorkflowContext(baseInput({ workflowId: "" }));
    assert.ok(errors.some((e) => e.includes("workflowId")));
  });

  test("requires eventPayload to be an object", () => {
    const errors = validateWorkflowContext(baseInput({ eventPayload: null }));
    assert.ok(errors.some((e) => e.includes("eventPayload")));
  });

  test("rejects unknown actionType", () => {
    const errors = validateWorkflowContext(baseInput({ actionType: "fax" }));
    assert.ok(errors.some((e) => e.includes("actionType")));
  });

  test("accepts all valid action types", () => {
    for (const type of VALID_ACTION_TYPES) {
      const errors = validateWorkflowContext(baseInput({ actionType: type }));
      assert.deepEqual(errors, [], `Expected no errors for actionType=${type}`);
    }
  });

  test("requires actionUrl", () => {
    const errors = validateWorkflowContext(baseInput({ actionUrl: "" }));
    assert.ok(errors.some((e) => e.includes("actionUrl")));
  });

  test("rejects negative maxRetries", () => {
    const errors = validateWorkflowContext(baseInput({ maxRetries: -1 }));
    assert.ok(errors.some((e) => e.includes("maxRetries")));
  });
});

// ── retryDelay ────────────────────────────────────────────────────────────────

describe("retryDelay", () => {
  test("returns 1000ms on first retry (retryCount=0)", () => {
    assert.equal(retryDelay({ retryCount: 0 }), 1000);
  });

  test("returns 2000ms on second retry", () => {
    assert.equal(retryDelay({ retryCount: 1 }), 2000);
  });

  test("caps at 30000ms", () => {
    assert.equal(retryDelay({ retryCount: 10 }), 30000);
  });
});

// ── machine state transitions ─────────────────────────────────────────────────

describe("workflow state machine", () => {
  test("starts in idle state", () => {
    const actor = makeActor(baseInput(), async () => ({ status: 200 }));
    actor.start();
    assert.equal(actor.getSnapshot().value, "idle");
    actor.stop();
  });

  test("transitions idle → validating → pending on START", async () => {
    const actor = makeActor(baseInput(), async () => ({ status: 200 }));
    actor.start();
    actor.send({ type: "START" });

    const snap = await waitFor(actor, (s) => s.value === "pending", {
      timeout: 3000,
    });
    assert.equal(snap.value, "pending");
    actor.stop();
  });

  test("transitions pending → executing → completed on EVENT_RECEIVED with success", async () => {
    const actor = makeActor(baseInput(), async () => ({ status: 200 }));
    actor.start();
    actor.send({ type: "START" });

    await waitFor(actor, (s) => s.value === "pending", { timeout: 3000 });
    actor.send({ type: "EVENT_RECEIVED" });

    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 3000,
    });
    assert.equal(snap.value, "completed");
    assert.ok(snap.context.completedAt instanceof Date);
    actor.stop();
  });

  test("goes to failed on validation error (bad actionType)", async () => {
    const actor = makeActor(baseInput({ actionType: "invalid" }), async () => ({
      status: 200,
    }));
    actor.start();
    actor.send({ type: "START" });

    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 3000,
    });
    assert.equal(snap.value, "failed");
    assert.ok(snap.context.lastError);
    actor.stop();
  });

  test("retries on executeAction failure then completes on success", async () => {
    let callCount = 0;
    const executeAction = async () => {
      callCount++;
      if (callCount < 2) throw new Error("temporary failure");
      return { status: 200 };
    };

    const actor = makeActor(baseInput({ maxRetries: 3 }), executeAction);
    actor.start();
    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.value === "pending", { timeout: 3000 });
    actor.send({ type: "EVENT_RECEIVED" });

    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 15000,
    });
    assert.equal(snap.value, "completed");
    assert.equal(snap.context.retryCount, 1);
    actor.stop();
  });

  test("goes to failed after exhausting all retries", async () => {
    const executeAction = async () => {
      throw new Error("always fails");
    };

    const actor = makeActor(baseInput({ maxRetries: 1 }), executeAction);
    actor.start();
    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.value === "pending", { timeout: 3000 });
    actor.send({ type: "EVENT_RECEIVED" });

    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 15000,
    });
    assert.equal(snap.value, "failed");
    assert.equal(snap.context.retryCount, 1);
    assert.ok(snap.context.lastError.includes("always fails"));
    actor.stop();
  });

  test("CANCEL in pending state goes to failed", async () => {
    const actor = makeActor(baseInput(), async () => ({ status: 200 }));
    actor.start();
    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.value === "pending", { timeout: 3000 });

    actor.send({ type: "CANCEL" });
    const snap = await waitFor(actor, (s) => s.status === "done", {
      timeout: 3000,
    });
    assert.equal(snap.value, "failed");
    actor.stop();
  });

  test("startedAt is set when START is sent", async () => {
    const actor = makeActor(baseInput(), async () => ({ status: 200 }));
    actor.start();
    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.value === "pending", { timeout: 3000 });

    const snap = actor.getSnapshot();
    assert.ok(snap.context.startedAt instanceof Date);
    actor.stop();
  });
});
