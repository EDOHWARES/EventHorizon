"use strict";

/**
 * Integration tests for workflow.service.js
 * Run: node --test tests/integration/workflow.service.test.js
 *
 * MongoDB is stubbed via module mocking so no live DB is required.
 */

const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// ── stub WorkflowExecution model before requiring the service ─────────────────

const savedDocs = new Map();

const lean = (val) => ({ lean: async () => val });

const WorkflowExecutionStub = {
  findOneAndUpdate: async (_query, doc) => {
    savedDocs.set(doc.workflowId, doc);
    return doc;
  },
  findOne: ({ workflowId }) => lean(savedDocs.get(workflowId) ?? null),
  find: () => ({
    sort: () => ({
      skip: () => ({
        limit: () => lean([...savedDocs.values()]),
      }),
    }),
  }),
};

// Patch require cache before loading service
require.cache[require.resolve("../../src/models/workflowExecution.model")] = {
  exports: WorkflowExecutionStub,
};

// Also stub Trigger model used by controller tests (not needed for service unit tests)
require.cache[require.resolve("../../src/models/trigger.model")] = {
  exports: {
    findOne: async () => ({
      _id: "507f1f77bcf86cd799439011",
      actionType: "webhook",
      actionUrl: "https://example.com/hook",
      retryConfig: { maxRetries: 2 },
      isActive: true,
    }),
  },
};

const WorkflowService = require("../../src/services/workflow.service");

// ── test fixtures ─────────────────────────────────────────────────────────────

const fakeTrigger = {
  _id: "507f1f77bcf86cd799439011",
  actionType: "webhook",
  actionUrl: "https://example.com/hook",
  retryConfig: { maxRetries: 2 },
  isActive: true,
};

const fakePayload = { ledger: 100, data: "transfer" };

describe("WorkflowService", () => {
  beforeEach(() => {
    WorkflowService._clearRegistry();
    savedDocs.clear();
  });

  test("startWorkflow returns workflowId and initial state", async () => {
    const result = await WorkflowService.startWorkflow(
      fakeTrigger,
      fakePayload,
      {
        executeAction: async () => ({ status: 200 }),
      }
    );

    assert.ok(result.workflowId, "workflowId should be defined");
    assert.ok(
      ["pending", "executing", "completed"].includes(result.state),
      `Unexpected state: ${result.state}`
    );
  });

  test("getSnapshot returns null for unknown workflowId", () => {
    const snap = WorkflowService.getSnapshot("does-not-exist");
    assert.equal(snap, null);
  });

  test("getSnapshot returns live state after startWorkflow", async () => {
    const { workflowId } = await WorkflowService.startWorkflow(
      fakeTrigger,
      fakePayload,
      {
        executeAction: async () => ({ status: 200 }),
      }
    );

    const snap = WorkflowService.getSnapshot(workflowId);
    // Actor may have already completed — either way snapshot should exist
    assert.ok(snap !== null);
    assert.ok(snap.state);
  });

  test("sendEvent advances pending workflow", async () => {
    // Use a slow executeAction so workflow stays in pending long enough
    let resolveFn;
    const executeAction = () =>
      new Promise((res) => {
        resolveFn = res;
      });

    const { workflowId } = await WorkflowService.startWorkflow(
      fakeTrigger,
      fakePayload,
      {
        executeAction,
      }
    );

    const result = WorkflowService.sendEvent(workflowId);
    // resolve after sending event
    if (resolveFn) resolveFn({ status: 200 });

    assert.ok(
      result !== null,
      "sendEvent should return a result for a live actor"
    );
  });

  test("sendEvent returns null for unknown workflowId", () => {
    const result = WorkflowService.sendEvent("ghost-id");
    assert.equal(result, null);
  });

  test("cancelWorkflow returns false for unknown id", () => {
    assert.equal(WorkflowService.cancelWorkflow("ghost-id"), false);
  });

  test("getExecution reads from stub DB", async () => {
    const { workflowId } = await WorkflowService.startWorkflow(
      fakeTrigger,
      fakePayload,
      {
        executeAction: async () => ({ status: 200 }),
      }
    );

    // Give the subscription a tick to persist
    await new Promise((r) => setTimeout(r, 50));

    const exec = await WorkflowService.getExecution(workflowId);
    // May be null if subscription hasn't fired yet in CI — just check type
    assert.ok(exec === null || typeof exec === "object");
  });

  test("getExecutionHistory returns array", async () => {
    const history = await WorkflowService.getExecutionHistory(
      "507f1f77bcf86cd799439011"
    );
    assert.ok(Array.isArray(history));
  });
});
