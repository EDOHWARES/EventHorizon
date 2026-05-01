const test = require('node:test');
const assert = require('node:assert/strict');
const {
    WorkflowExecutionError,
    executeWorkflow,
} = require('../src/services/workflow.service');
const { resolveTemplates } = require('../src/utils/templater');

function trigger(overrides = {}) {
    return {
        _id: 'trigger-1',
        organization: 'org-1',
        contractId: 'contract-1',
        eventName: 'Transfer',
        steps: [],
        ...overrides,
    };
}

test('workflow executes sequential steps and stores keyed results', async () => {
    const calls = [];
    const result = await executeWorkflow(trigger({
        steps: [
            { id: 'first', actionType: 'webhook', actionUrl: 'https://example.com/first' },
            { id: 'second', actionType: 'telegram', actionUrl: 'chat-1' },
        ],
    }), { amount: 10 }, {
        runId: 'run-1',
        executeStep: async (stepTrigger, eventPayload, options) => {
            calls.push({ stepTrigger, eventPayload, options });
            return { receivedStep: stepTrigger.id };
        },
    });

    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.context.stepOrder, ['first', 'second']);
    assert.equal(result.context.steps.first.success, true);
    assert.equal(result.context.steps.second.output.receivedStep, 'second');
    assert.equal(calls[1].options.context.steps.first.output.receivedStep, 'first');
});

test('default runIf success skips the next step after a failure', async () => {
    let error;
    try {
        await executeWorkflow(trigger({
            steps: [
                { id: 'first', actionType: 'webhook', actionUrl: 'https://example.com/first' },
                { id: 'second', actionType: 'webhook', actionUrl: 'https://example.com/second' },
            ],
        }), {}, {
            runId: 'run-2',
            executeStep: async (stepTrigger) => {
                if (stepTrigger.id === 'first') {
                    throw new Error('downstream failed');
                }
                return { ok: true };
            },
        });
    } catch (caught) {
        error = caught;
    }

    assert.ok(error instanceof WorkflowExecutionError);
    assert.equal(error.result.status, 'failed');
    assert.equal(error.result.context.steps.first.success, false);
    assert.equal(error.result.context.steps.second.skipped, true);
});

test('runIf failure allows a compensating step to run', async () => {
    let error;
    try {
        await executeWorkflow(trigger({
            steps: [
                { id: 'primary', actionType: 'webhook', actionUrl: 'https://example.com/primary' },
                { id: 'compensate', actionType: 'telegram', actionUrl: 'chat-1', runIf: 'failure' },
            ],
        }), {}, {
            runId: 'run-3',
            executeStep: async (stepTrigger) => {
                if (stepTrigger.id === 'primary') throw new Error('failed');
                return { alertSent: true };
            },
        });
    } catch (caught) {
        error = caught;
    }

    assert.ok(error instanceof WorkflowExecutionError);
    assert.equal(error.result.context.steps.primary.success, false);
    assert.equal(error.result.context.steps.compensate.success, true);
    assert.deepEqual(error.result.context.steps.compensate.output, { alertSent: true });
});

test('continueOnError returns failed workflow result instead of throwing', async () => {
    const result = await executeWorkflow(trigger({
        workflowConfig: { continueOnError: true },
        steps: [
            { id: 'primary', actionType: 'webhook', actionUrl: 'https://example.com/primary' },
            { id: 'cleanup', actionType: 'telegram', actionUrl: 'chat-1', runIf: 'failure' },
        ],
    }), {}, {
        runId: 'run-4',
        executeStep: async (stepTrigger) => {
            if (stepTrigger.id === 'primary') throw new Error('failed');
            return { ok: true };
        },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.context.steps.cleanup.success, true);
});

test('templates resolve against keyed workflow context', async () => {
    const calls = [];
    await executeWorkflow(trigger({
        steps: [
            { id: 'fetchUser', actionType: 'webhook', actionUrl: 'https://example.com/fetch' },
            {
                id: 'notifyUser',
                actionType: 'webhook',
                actionUrl: 'https://example.com/users/{{steps.fetchUser.output.userId}}',
                config: {
                    message: 'User {{steps.fetchUser.output.userId}} moved {{event.amount}} tokens',
                },
            },
        ],
    }), { amount: 25 }, {
        runId: 'run-5',
        executeStep: async (stepTrigger) => {
            calls.push(stepTrigger);
            if (stepTrigger.id === 'fetchUser') return { userId: 'user-123' };
            return { notified: stepTrigger.actionUrl };
        },
    });

    assert.equal(calls[1].actionUrl, 'https://example.com/users/user-123');
    assert.equal(calls[1].config.message, 'User user-123 moved 25 tokens');
});

test('missing template paths are left unchanged', () => {
    const value = resolveTemplates({
        url: 'https://example.com/{{steps.missing.output.id}}',
    }, { steps: {} });

    assert.equal(value.url, 'https://example.com/{{steps.missing.output.id}}');
});
