const Joi = require('joi');
const ipWhitelistService = require('../services/ipWhitelist.service');
const {
    validateFilters,
    MAX_FILTERS_PER_TRIGGER,
} = require('../utils/jsonpathValidator');

const filterSchema = Joi.object({
    path: Joi.string().trim().required(),
    operator: Joi.string()
        .valid('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists')
        .required(),
    value: Joi.any(),
});

const filtersSchema = Joi.array()
    .items(filterSchema)
    .max(MAX_FILTERS_PER_TRIGGER)
    .custom((value, helpers) => {
        const result = validateFilters(value);
        if (!result.ok) {
            return helpers.error('any.invalid', { message: result.error });
        }
        return value;
    }, 'JSONPath security validation')
    .messages({
        'any.invalid': '{{#message}}',
    });

const workflowStepIdSchema = Joi.string()
    .trim()
    .pattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
    .required()
    .messages({
        'string.pattern.base': 'Workflow step id must start with a letter and contain only letters, numbers, underscores, or hyphens',
    });

const workflowStepSchema = Joi.object({
    id: workflowStepIdSchema,
    name: Joi.string().trim(),
    actionType: Joi.string().valid('webhook', 'discord', 'email', 'telegram').required(),
    actionUrl: Joi.string().trim(),
    webhookSecret: Joi.string(),
    config: Joi.object().unknown(true).default({}),
    runIf: Joi.string().valid('success', 'failure', 'always').default('success'),
}).custom((value, helpers) => {
    if (['webhook', 'discord'].includes(value.actionType) && !value.actionUrl) {
        return helpers.error('any.invalid', {
            message: `Workflow step "${value.id}" requires actionUrl for ${value.actionType}`,
        });
    }
    if (['webhook', 'discord'].includes(value.actionType)) {
        const { error } = Joi.string().uri().validate(value.actionUrl);
        if (error) {
            return helpers.error('any.invalid', {
                message: `Workflow step "${value.id}" actionUrl must be a valid URI`,
            });
        }
    }
    return value;
}, 'workflow step validation').messages({
    'any.invalid': '{{#message}}',
});

const workflowStepsSchema = Joi.array()
    .items(workflowStepSchema)
    .max(20)
    .unique('id')
    .messages({
        'array.unique': 'Workflow step ids must be unique',
    });

const workflowConfigSchema = Joi.object({
    continueOnError: Joi.boolean().default(false),
});

const cidrSchema = Joi.string().trim().custom((value, helpers) => {
    try {
        ipWhitelistService.normalizeCidr(value);
        return value;
    } catch (error) {
        return helpers.error('any.invalid', { message: error.message });
    }
}, 'IP or CIDR validation').messages({
    'any.invalid': '{{#message}}',
});

const validationSchemas = {
    triggerCreate: Joi.object({
        contractId: Joi.string().trim().required(),
        eventName: Joi.string().trim().required(),
        actionType: Joi.string().valid('webhook', 'discord', 'email', 'telegram'),
        actionUrl: Joi.string().trim().uri(),
        isActive: Joi.boolean().default(true),
        lastPolledLedger: Joi.number().integer().min(0).default(0),
        filters: filtersSchema.default([]),
        steps: workflowStepsSchema.default([]),
        workflowConfig: workflowConfigSchema.default({ continueOnError: false }),
    }).custom((value, helpers) => {
        const hasWorkflowSteps = Array.isArray(value.steps) && value.steps.length > 0;
        if (hasWorkflowSteps && value.actionUrl) {
            return helpers.error('any.invalid', {
                message: 'Workflow triggers cannot also define top-level actionUrl',
            });
        }
        if (!hasWorkflowSteps && !value.actionUrl) {
            return helpers.error('any.invalid', {
                message: 'Trigger actionUrl is required when steps are not provided',
            });
        }
        return value;
    }, 'trigger workflow validation').messages({
        'any.invalid': '{{#message}}',
    }),
    triggerUpdate: Joi.object({
        contractId: Joi.string().trim(),
        eventName: Joi.string().trim(),
        actionType: Joi.string().valid('webhook', 'discord', 'email', 'telegram'),
        actionUrl: Joi.string().trim().uri(),
        isActive: Joi.boolean(),
        lastPolledLedger: Joi.number().integer().min(0),
        filters: filtersSchema,
        steps: workflowStepsSchema,
        workflowConfig: workflowConfigSchema,
    }).min(1).custom((value, helpers) => {
        const hasWorkflowSteps = Array.isArray(value.steps) && value.steps.length > 0;
        if (hasWorkflowSteps && value.actionUrl) {
            return helpers.error('any.invalid', {
                message: 'Workflow triggers cannot also define top-level actionUrl',
            });
        }
        return value;
    }, 'trigger workflow update validation').messages({
        'any.invalid': '{{#message}}',
    }),
    authCredentials: Joi.object({
        email: Joi.string().trim().email().required(),
        password: Joi.string().min(8).required(),
    }),
    register: Joi.object({
        email: Joi.string().trim().email().required(),
        password: Joi.string().min(8).required(),
        firstName: Joi.string().trim().required(),
        lastName: Joi.string().trim().required(),
        organizationName: Joi.string().trim().required(),
    }),
    inviteUser: Joi.object({
        email: Joi.string().trim().email().required(),
        roleId: Joi.string().trim().required(),
    }),
    acceptInvitation: Joi.object({
        token: Joi.string().trim().required(),
        password: Joi.string().min(8).required(),
        firstName: Joi.string().trim().required(),
        lastName: Joi.string().trim().required(),
    }),
    createRole: Joi.object({
        name: Joi.string().trim().required(),
        description: Joi.string().trim(),
        permissions: Joi.array().items(Joi.string().valid(
            'create_trigger', 'read_trigger', 'update_trigger', 'delete_trigger',
            'manage_users', 'manage_organization', 'view_audit_logs'
        )).required(),
    }),
    ipWhitelistEntry: Joi.object({
        cidr: cidrSchema.required(),
        label: Joi.string().trim().allow('').default(''),
        enabled: Joi.boolean().default(true),
    }),
    ipWhitelistEntryUpdate: Joi.object({
        cidr: cidrSchema,
        label: Joi.string().trim().allow(''),
        enabled: Joi.boolean(),
    }).min(1),
};

const mapValidationErrors = (details) =>
    details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
    }));

const validateRequest = (schema, source = 'body') => (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: source === 'body',
        convert: true,
    });

    if (error) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: mapValidationErrors(error.details),
        });
    }

    req[source] = value;
    return next();
};

const validateBody = (schema) => validateRequest(schema, 'body');

module.exports = {
    validationSchemas,
    validateRequest,
    validateBody,
};
