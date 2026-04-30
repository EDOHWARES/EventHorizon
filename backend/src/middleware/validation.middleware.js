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
        actionType: Joi.string().valid('webhook', 'discord', 'email', 'telegram').default('webhook'),
        actionUrl: Joi.string().trim().uri().required(),
        isActive: Joi.boolean().default(true),
        lastPolledLedger: Joi.number().integer().min(0).default(0),
        filters: filtersSchema.default([]),
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
