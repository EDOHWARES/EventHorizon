const AuditLog = require('../models/audit.model');
const logger = require('../config/logger');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const retentionService = require('../services/retention.service');

/**
 * Admin-only audit log controller
 * Provides secure access to audit logs for compliance and debugging
 */

// Admin authorization check (placeholder - should be replaced with proper auth)
const checkAdminAccess = (req, res, next) => {
    // TODO: Replace with proper admin authentication/authorization
    // For now, this is a placeholder that could check for admin tokens, roles, etc.

    const adminToken = req.headers['x-admin-token'] || req.query.adminToken;
    const expectedToken = process.env.ADMIN_ACCESS_TOKEN;

    if (!expectedToken) {
        logger.warn('Admin access token not configured');
        throw new AppError('Admin access not configured', 503);
    }

    if (!adminToken || adminToken !== expectedToken) {
        logger.warn('Unauthorized admin access attempt', {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        throw new AppError('Unauthorized admin access', 403);
    }

    next();
};

/**
 * Get audit logs with filtering and pagination
 */
exports.getAuditLogs = [
    checkAdminAccess,
    asyncHandler(async (req, res) => {
        logger.info('Admin accessing audit logs', {
            ip: req.ip,
            userAgent: req.get('User-Agent')
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
        const query = {};

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
    })
];

/**
 * Get audit trail for a specific resource
 */
exports.getResourceAuditTrail = [
    checkAdminAccess,
    asyncHandler(async (req, res) => {
        const { resourceId } = req.params;
        const { operations, limit = 100, skip = 0 } = req.query;

        logger.info('Admin accessing resource audit trail', {
            resourceId,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const opsArray = operations ? operations.split(',') : null;

        const logs = await AuditLog.getAuditTrail(resourceId, {
            limit: parseInt(limit),
            skip: parseInt(skip),
            operations: opsArray
        });

        res.json({
            success: true,
            data: {
                resourceId,
                logs,
                count: logs.length
            }
        });
    })
];

/**
 * Get audit log statistics
 */
exports.getAuditStats = [
    checkAdminAccess,
    asyncHandler(async (req, res) => {
        logger.info('Admin accessing audit statistics', {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const { startDate, endDate } = req.query;

        // Build date filter
        const dateFilter = {};
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
                    timestamp: { $gte: thirtyDaysAgo },
                    ...dateFilter.timestamp
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
    })
];

/**
 * Verify integrity of a specific audit log
 */
exports.verifyLogIntegrity = [
    checkAdminAccess,
    asyncHandler(async (req, res) => {
        const { logId } = req.params;

        logger.info('Admin verifying log integrity', {
            logId,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const isValid = await AuditLog.verifyIntegrity(logId);

        res.json({
            success: true,
            data: {
                logId,
                integrityValid: isValid
            }
        });
    })
];

/**
 * Bulk verify integrity of audit logs
 */
exports.bulkVerifyIntegrity = [
    checkAdminAccess,
    asyncHandler(async (req, res) => {
        const { startDate, endDate, sampleSize = 100 } = req.query;

        logger.info('Admin bulk verifying log integrity', {
            sampleSize,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        // Get sample of logs
        const query = {};
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
    })
];

/**
 * Search archived audit logs
 */
exports.searchArchive = [
    checkAdminAccess,
    asyncHandler(async (req, res) => {
        const { query, startDate, endDate } = req.query;

        logger.info('Admin searching archive', {
            query,
            startDate,
            endDate,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const results = await retentionService.searchArchive(query, startDate, endDate);

        res.json({
            success: true,
            data: results
        });
    })
];