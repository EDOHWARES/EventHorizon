const Trigger = require('../models/trigger.model');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

exports.createTrigger = asyncHandler(async (req, res) => {
    const trigger = new Trigger(req.body);
    await trigger.save();

    res.status(201).json({
        success: true,
        data: trigger,
    });
});

exports.getTriggers = asyncHandler(async (_req, res) => {
    const triggers = await Trigger.find();

    res.json({
        success: true,
        data: triggers,
    });
});

exports.deleteTrigger = asyncHandler(async (req, res) => {
    const trigger = await Trigger.findByIdAndDelete(req.params.id);

    if (!trigger) {
        throw new AppError('Trigger not found', 404);
    }

    res.status(204).send();
});
