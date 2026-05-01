const Trigger = require('../models/trigger.model');
const logger = require('../config/logger');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ipWhitelistService = require('../services/ipWhitelist.service');

async function validateWebhookDestinationIfNeeded(body, organizationId, currentTrigger = null) {
    const actionType = body.actionType ?? currentTrigger?.actionType ?? 'webhook';
    const actionUrl = body.actionUrl ?? currentTrigger?.actionUrl;

    if (actionType !== 'webhook' || !actionUrl) {
        return [];
    }

    const result = await ipWhitelistService.validateUrl(actionUrl, organizationId, {
        allowDnsFailure: true,
    });

    return result.warnings || [];
}

exports.createTrigger = asyncHandler(async (req, res) => {
    logger.info('Creating new trigger', {
        contractId: req.body.contractId,
        eventName: req.body.eventName,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const warnings = await validateWebhookDestinationIfNeeded(
        req.body,
        req.user.organization._id
    );

    const trigger = new Trigger({
        ...req.body,
        organization: req.user.organization._id,
        createdBy: req.user.id,
    });
    await trigger.save();

    logger.info('Trigger created successfully', {
        triggerId: trigger._id,
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        isActive: trigger.isActive,
    });

    res.status(201).json({
        success: true,
        data: trigger,
        warnings,
    });
});

exports.getTriggers = asyncHandler(async (req, res) => {
    logger.debug('Fetching triggers for organization', {
        ip: req.ip,
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const triggers = await Trigger.find({ organization: req.user.organization._id });

    logger.info('Triggers fetched successfully', {
        count: triggers.length,
        ip: req.ip,
    });

    res.json({
        success: true,
        data: triggers,
    });
});

exports.deleteTrigger = asyncHandler(async (req, res) => {
    logger.info('Deleting trigger', {
        triggerId: req.params.id,
        ip: req.ip,
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const trigger = await Trigger.findOneAndDelete({
        _id: req.params.id,
        organization: req.user.organization._id,
    });

    if (!trigger) {
        logger.warn('Trigger not found for deletion', {
            triggerId: req.params.id,
            ip: req.ip,
        });

        throw new AppError('Trigger not found', 404);
    }

    logger.info('Trigger deleted successfully', {
        triggerId: req.params.id,
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        ip: req.ip,
    });

    res.status(204).send();
});

exports.updateTrigger = asyncHandler(async (req, res) => {
    logger.info('Updating trigger', {
        triggerId: req.params.id,
        ip: req.ip,
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const existingTrigger = await Trigger.findOne({
        _id: req.params.id,
        organization: req.user.organization._id,
    });

    if (!existingTrigger) {
        logger.warn('Trigger not found for update', {
            triggerId: req.params.id,
            ip: req.ip,
        });

        throw new AppError('Trigger not found', 404);
    }

    const warnings = await validateWebhookDestinationIfNeeded(
        req.body,
        req.user.organization._id,
        existingTrigger
    );

    const trigger = await Trigger.findOneAndUpdate(
        { _id: req.params.id, organization: req.user.organization._id },
        req.body,
        { new: true, runValidators: true }
    );

    logger.info('Trigger updated successfully', {
        triggerId: req.params.id,
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        batchingEnabled: trigger.batchingConfig?.enabled,
        ip: req.ip,
    });

    res.json({
        success: true,
        data: trigger,
        warnings,
    });
});
