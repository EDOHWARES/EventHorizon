const IpWhitelist = require('../models/ipWhitelist.model');
const ipWhitelistService = require('../services/ipWhitelist.service');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

exports.listEntries = asyncHandler(async (req, res) => {
    const entries = await IpWhitelist.find({
        organization: req.user.organization._id,
    }).sort({ createdAt: -1 });

    res.json({
        success: true,
        data: entries,
    });
});

exports.createEntry = asyncHandler(async (req, res) => {
    const entry = await ipWhitelistService.createEntry({
        organizationId: req.user.organization._id,
        cidr: req.body.cidr,
        label: req.body.label,
        enabled: req.body.enabled,
        addedBy: req.user.id,
    });

    res.status(201).json({
        success: true,
        data: entry,
    });
});

exports.updateEntry = asyncHandler(async (req, res) => {
    const updates = {};

    if (req.body.cidr !== undefined) {
        updates.cidr = ipWhitelistService.normalizeCidr(req.body.cidr);
    }
    if (req.body.label !== undefined) {
        updates.label = req.body.label;
    }
    if (req.body.enabled !== undefined) {
        updates.enabled = req.body.enabled;
    }

    const entry = await IpWhitelist.findOneAndUpdate(
        { _id: req.params.id, organization: req.user.organization._id },
        updates,
        { new: true, runValidators: true }
    );

    if (!entry) {
        throw new AppError('IP whitelist entry not found', 404);
    }

    res.json({
        success: true,
        data: entry,
    });
});

exports.deleteEntry = asyncHandler(async (req, res) => {
    const entry = await IpWhitelist.findOneAndDelete({
        _id: req.params.id,
        organization: req.user.organization._id,
    });

    if (!entry) {
        throw new AppError('IP whitelist entry not found', 404);
    }

    res.status(204).send();
});
