# Conditional Action Workflows

EventHorizon triggers can execute ordered backend workflows by adding `steps` to the trigger payload. Workflows are backend-only and run sequentially for each matched Soroban event.

## Schema

```json
{
  "contractId": "CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "eventName": "Transfer",
  "steps": [
    {
      "id": "notifyPartner",
      "name": "Notify partner system",
      "actionType": "webhook",
      "actionUrl": "https://partner.example.com/events",
      "webhookSecret": "optional-step-secret",
      "runIf": "success",
      "config": {}
    },
    {
      "id": "sendFallbackAlert",
      "actionType": "telegram",
      "actionUrl": "123456789",
      "runIf": "failure",
      "config": {
        "message": "Partner webhook failed for {{event.transactionHash}}"
      }
    }
  ]
}
```

Workflow step fields:

- `id`: required stable identifier. It must start with a letter and contain only letters, numbers, underscores, or hyphens.
- `name`: optional display name used for logs and future UI.
- `actionType`: one of `webhook`, `discord`, `email`, or `telegram`.
- `actionUrl`: destination URL or integration identifier. Required for `webhook` and `discord`.
- `webhookSecret`: optional per-step webhook signing secret.
- `config`: action-specific settings. String values can use workflow templates.
- `runIf`: `success`, `failure`, or `always`. Defaults to `success`.

When `steps` is present, the trigger must not include top-level `actionUrl`. Existing single-action triggers without `steps` continue to run through the previous action path.

## Execution Rules

Steps execute in array order. Each step result is written into a workflow context:

```json
{
  "runId": "bullmq-job-id-or-generated-id",
  "event": {},
  "trigger": {
    "contractId": "CAX...",
    "eventName": "Transfer"
  },
  "stepOrder": ["notifyPartner"],
  "steps": {
    "notifyPartner": {
      "id": "notifyPartner",
      "actionType": "webhook",
      "success": true,
      "skipped": false,
      "output": {},
      "error": null,
      "durationMs": 42
    }
  },
  "lastResult": {}
}
```

`runIf` is evaluated against the immediately previous step result:

- `success`: run only if the previous step succeeded. For the first step, this evaluates to true.
- `failure`: run only if the previous step failed.
- `always`: run regardless of the previous step result.

If a step fails, later `runIf: "failure"` steps can run as compensating actions. Unless `workflowConfig.continueOnError` is set to `true`, the workflow reports failure after all eligible steps are evaluated.

`continueOnError` only changes whether a failed workflow throws at the end. It does not make default `runIf: "success"` steps continue after a failure. To continue running later steps after a failed step, set those later steps to `runIf: "always"` or `runIf: "failure"`.

## State Passing

Templates are resolved before each step executes. Templates are read-only dot paths against the workflow context and do not evaluate code.

```json
{
  "id": "notifyUser",
  "actionType": "webhook",
  "actionUrl": "https://example.com/users/{{steps.lookupUser.output.userId}}",
  "config": {
    "message": "Transfer amount: {{event.amount}}"
  }
}
```

Missing paths are left unchanged so bad templates are visible in downstream payloads and logs.

Webhook workflow steps include workflow metadata in the signed body:

```json
{
  "contractId": "CAX...",
  "eventName": "Transfer",
  "payload": {},
  "workflow": {
    "runId": "123",
    "stepId": "notifyPartner",
    "previousSteps": {},
    "stepOrder": [],
    "lastResult": null
  }
}
```

Receivers should use `workflow.runId` and `workflow.stepId` for deduplication.

## Retry And Idempotency

BullMQ retries the whole job when a workflow fails. This means a previously successful step may run again on retry. Workflow receivers should be idempotent and dedupe by `runId` plus `stepId`.

Persisted step resume is intentionally out of scope for the first workflow backend PR.

## Benchmark Notes

Workflow overhead is small compared with outbound network latency. A local mocked executor benchmark can be run from a Node REPL or temporary script:

```js
const { executeWorkflow } = require('./backend/src/services/workflow.service');

async function bench(iterations) {
  const trigger = {
    contractId: 'contract',
    eventName: 'Event',
    steps: [
      { id: 'a', actionType: 'webhook', actionUrl: 'https://example.com/a' },
      { id: 'b', actionType: 'webhook', actionUrl: 'https://example.com/{{steps.a.output.id}}' }
    ]
  };
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await executeWorkflow(trigger, { i }, {
      runId: `bench-${i}`,
      executeStep: async (step) => ({ id: step.id })
    });
  }
  return { iterations, totalMs: Date.now() - start };
}

Promise.all([bench(10), bench(100), bench(1000)]).then(console.log);
```

The benchmark excludes external APIs by using a mocked step executor.
