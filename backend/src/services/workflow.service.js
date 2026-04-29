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
