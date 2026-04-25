const AuditLog = require('../models/audit.model');
const logger = require('../config/logger');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Get audit logs with filtering and pagination
 */
exports.getAuditLogs = asyncHandler(async (req, res) => {
    logger.info('Accessing audit logs', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const {
        resourceId,
        operation,
        userId,
        ipAddress,
            startDate,
            endDate,
            limit = 50,
            skip = 0,
            sort = '-timestamp'
        } = req.query;

        // Build query
        const query = {
            organization: req.user.organization._id,
        };

        if (resourceId) query.resourceId = resourceId;
        if (operation) query.operation = operation;
        if (userId) query.userId = userId;
        if (ipAddress) query.ipAddress = ipAddress;

        // Date range filtering
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        // Execute query with pagination
        const logs = await AuditLog.find(query)
            .sort(sort)
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .populate('resourceId', 'contractId eventName actionType isActive');

        // Get total count for pagination
        const total = await AuditLog.countDocuments(query);

        logger.info('Audit logs retrieved', {
            count: logs.length,
            total,
            filters: { resourceId, operation, userId, ipAddress, startDate, endDate }
        });

        res.json({
            success: true,
            data: {
                logs,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    skip: parseInt(skip),
                    hasMore: total > parseInt(skip) + logs.length
                }
            }
        });
    });

/**
 * Get audit trail for a specific resource
 */
exports.getResourceAuditTrail = asyncHandler(async (req, res) => {
    const { resourceId } = req.params;
    const { operations, limit = 100, skip = 0 } = req.query;

    logger.info('Accessing resource audit trail', {
        resourceId,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const opsArray = operations ? operations.split(',') : null;

    const logs = await AuditLog.getAuditTrail(resourceId, {
        limit: parseInt(limit),
        skip: parseInt(skip),
        operations: opsArray,
        organization: req.user.organization._id,
    });

    res.json({
        success: true,
        data: {
            resourceId,
            logs,
            count: logs.length
        }
    });
});

/**
 * Get audit log statistics
 */
exports.getAuditStats = asyncHandler(async (req, res) => {
    logger.info('Accessing audit statistics', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = { organization: req.user.organization._id };
    if (startDate || endDate) {
        dateFilter.timestamp = {};
        if (startDate) dateFilter.timestamp.$gte = new Date(startDate);
        if (endDate) dateFilter.timestamp.$lte = new Date(endDate);
    }

    // Get operation counts
    const operationStats = await AuditLog.aggregate([
        { $match: dateFilter },
        {
            $group: {
                _id: '$operation',
                count: { $sum: 1 },
                lastActivity: { $max: '$timestamp' }
            }
        },
        { $sort: { count: -1 } }
    ]);

    // Get daily activity for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyStats = await AuditLog.aggregate([
        {
            $match: {
                organization: req.user.organization._id,
                timestamp: { $gte: thirtyDaysAgo },
                ...(dateFilter.timestamp && { timestamp: dateFilter.timestamp })
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                },
                count: { $sum: 1 },
                operations: {
                    $push: '$operation'
                }
            }
        },
        { $sort: { '_id': 1 } }
    ]);

    // Get top IP addresses
    const topIPs = await AuditLog.aggregate([
        { $match: dateFilter },
        {
            $group: {
                _id: '$ipAddress',
                count: { $sum: 1 },
                lastActivity: { $max: '$timestamp' }
            }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
    ]);

    // Get total count
    const totalLogs = await AuditLog.countDocuments(dateFilter);

    res.json({
        success: true,
        data: {
            totalLogs,
            operationStats,
            dailyStats,
            topIPs,
            dateRange: {
                startDate: startDate || thirtyDaysAgo.toISOString(),
                endDate: endDate || new Date().toISOString()
            }
        }
    });
});

/**
 * Verify integrity of a specific audit log
 */
exports.verifyLogIntegrity = asyncHandler(async (req, res) => {
    const { logId } = req.params;

    logger.info('Verifying log integrity', {
        logId,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    // First check if log belongs to organization
    const log = await AuditLog.findOne({
        _id: logId,
        organization: req.user.organization._id,
    });

    if (!log) {
        throw new AppError('Audit log not found', 404);
    }

    const isValid = await AuditLog.verifyIntegrity(logId);

    res.json({
        success: true,
        data: {
            logId,
            integrityValid: isValid
        }
    });
});

/**
 * Bulk verify integrity of audit logs
 */
exports.bulkVerifyIntegrity = asyncHandler(async (req, res) => {
    const { startDate, endDate, sampleSize = 100 } = req.query;

    logger.info('Bulk verifying log integrity', {
        sampleSize,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user.id,
        organizationId: req.user.organization._id,
    });

    // Get sample of logs
    const query = { organization: req.user.organization._id };
    if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const logs = await AuditLog.find(query)
        .limit(parseInt(sampleSize))
        .sort({ timestamp: -1 });

    // Verify each log
    const results = [];
    for (const log of logs) {
        const isValid = await AuditLog.verifyIntegrity(log._id);
        results.push({
            logId: log._id,
            timestamp: log.timestamp,
            operation: log.operation,
            integrityValid: isValid
        });
    }

    const validCount = results.filter(r => r.integrityValid).length;
    const invalidCount = results.length - validCount;

    res.json({
        success: true,
        data: {
            sampleSize: results.length,
            validCount,
            invalidCount,
            integrityRate: results.length > 0 ? (validCount / results.length) * 100 : 0,
            results: invalidCount > 0 ? results.filter(r => !r.integrityValid) : []
        }
    });
});