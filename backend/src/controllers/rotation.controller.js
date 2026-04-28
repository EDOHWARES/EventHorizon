const RotationPolicy = require('../models/rotationPolicy.model');
const Credential = require('../models/credential.model');
const { rotateCredential, processDueRotations } = require('../services/rotation.service');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');

/**
 * GET /api/credentials/:id/rotation-policy
 */
exports.getPolicy = asyncHandler(async (req, res) => {
    const policy = await RotationPolicy.findOne({ credentialId: req.params.id, userId: req.user.id });
    if (!policy) throw new AppError('No rotation policy found', 404);
    res.json(policy);
});

/**
 * POST /api/credentials/:id/rotation-policy
 * Body: { intervalHours }
 */
exports.upsertPolicy = asyncHandler(async (req, res) => {
    const { intervalHours } = req.body;
    if (!intervalHours || intervalHours < 1) throw new AppError('intervalHours must be >= 1', 400);

    const credential = await Credential.findOne({ _id: req.params.id, userId: req.user.id });
    if (!credential) throw new AppError('Credential not found', 404);

    const nextRotationAt = new Date(Date.now() + intervalHours * 3600 * 1000);

    const policy = await RotationPolicy.findOneAndUpdate(
        { credentialId: req.params.id, userId: req.user.id },
        { intervalHours, nextRotationAt, enabled: true },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json(policy);
});

/**
 * DELETE /api/credentials/:id/rotation-policy
 */
exports.deletePolicy = asyncHandler(async (req, res) => {
    const result = await RotationPolicy.findOneAndDelete({ credentialId: req.params.id, userId: req.user.id });
    if (!result) throw new AppError('No rotation policy found', 404);
    res.json({ message: 'Rotation policy deleted' });
});

/**
 * POST /api/credentials/:id/rotate  — manual rotation
 */
exports.rotateNow = asyncHandler(async (req, res) => {
    const credential = await Credential.findOne({ _id: req.params.id, userId: req.user.id });
    if (!credential) throw new AppError('Credential not found', 404);

    const result = await rotateCredential(req.params.id, {
        userId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
    });

    res.json(result);
});

/**
 * POST /api/credentials/rotate/process  — trigger due rotations (admin/cron)
 */
exports.processDue = asyncHandler(async (req, res) => {
    const results = await processDueRotations();
    res.json({ processed: results.length, results });
});
