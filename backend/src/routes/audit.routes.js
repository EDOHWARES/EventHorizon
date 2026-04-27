const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');

/**
 * @openapi
 * /api/admin/audit/logs:
 *   get:
 *     summary: Get audit logs with filtering
 *     description: Admin-only endpoint to retrieve audit logs with advanced filtering and pagination
 *     tags: [Admin, Audit]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: resourceId
 *         schema:
 *           type: string
 *         description: Filter by resource ID
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
 *           enum: [CREATE, UPDATE, DELETE]
 *         description: Filter by operation type
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: ipAddress
 *         schema:
 *           type: string
 *         description: Filter by IP address
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs before this date
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of logs to return
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of logs to skip
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     logs:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/AuditLog'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       403:
 *         description: Unauthorized admin access
 *       503:
 *         description: Admin access not configured
 */
router.get('/logs',
    authMiddleware,
    permissionMiddleware('view_audit_logs'),
    auditController.getAuditLogs
);

/**
 * @openapi
 * /api/admin/audit/stats:
 *   get:
 *     summary: Get audit statistics
 *     description: Admin-only endpoint to retrieve audit log statistics and analytics
 *     tags: [Admin, Audit]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for statistics
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for statistics
 *     responses:
 *       200:
 *         description: Audit statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalLogs:
 *                       type: integer
 *                     operationStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "CREATE"
 *                           count:
 *                             type: integer
 *                           lastActivity:
 *                             type: string
 *                             format: date-time
 *                     dailyStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "2024-01-15"
 *                           count:
 *                             type: integer
 *                           operations:
 *                             type: array
 *                             items:
 *                               type: string
 *                     topIPs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "192.168.1.1"
 *                           count:
 *                             type: integer
 *                           lastActivity:
 *                             type: string
 *                             format: date-time
 *       403:
 *         description: Unauthorized admin access
 */
router.get('/stats',
    authMiddleware,
    permissionMiddleware('view_audit_logs'),
    auditController.getAuditStats
);

/**
 * @openapi
 * /api/admin/audit/resources/{resourceId}/trail:
 *   get:
 *     summary: Get audit trail for a specific resource
 *     description: Admin-only endpoint to retrieve the complete audit trail for a specific resource
 *     tags: [Admin, Audit]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: resourceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Resource ID to get audit trail for
 *       - in: query
 *         name: operations
 *         schema:
 *           type: string
 *         description: Comma-separated list of operations to filter (CREATE,UPDATE,DELETE)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of logs to return
 *     responses:
 *       200:
 *         description: Resource audit trail retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     resourceId:
 *                       type: string
 *                     logs:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/AuditLog'
 *                     count:
 *                       type: integer
 *       403:
 *         description: Unauthorized admin access
 *       404:
 *         description: Resource not found
 */
router.get('/resources/:resourceId/trail',
    authMiddleware,
    permissionMiddleware('view_audit_logs'),
    auditController.getResourceAuditTrail
);

/**
 * @openapi
 * /api/admin/audit/logs/{logId}/verify:
 *   get:
 *     summary: Verify integrity of a specific audit log
 *     description: Admin-only endpoint to verify the integrity hash of a specific audit log entry
 *     tags: [Admin, Audit]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: string
 *         description: Audit log ID to verify
 *     responses:
 *       200:
 *         description: Log integrity verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     logId:
 *                       type: string
 *                     integrityValid:
 *                       type: boolean
 *       403:
 *         description: Unauthorized admin access
 *       404:
 *         description: Audit log not found
 */
router.get('/logs/:logId/verify',
    authMiddleware,
    permissionMiddleware('view_audit_logs'),
    auditController.verifyLogIntegrity
);

/**
 * @openapi
 * /api/admin/audit/verify:
 *   get:
 *     summary: Bulk verify audit log integrity
 *     description: Admin-only endpoint to perform bulk integrity verification on audit logs
 *     tags: [Admin, Audit]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for verification
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for verification
 *       - in: query
 *         name: sampleSize
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of logs to sample for verification
 *     responses:
 *       200:
 *         description: Bulk integrity verification completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sampleSize:
 *                       type: integer
 *                     validCount:
 *                       type: integer
 *                     invalidCount:
 *                       type: integer
 *                     integrityRate:
 *                       type: number
 *                       format: float
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           logId:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                           operation:
 *                             type: string
 *                           integrityValid:
 *                             type: boolean
 *       403:
 *         description: Unauthorized admin access
 */
router.get('/verify',
    authMiddleware,
    permissionMiddleware('view_audit_logs'),
    auditController.bulkVerifyIntegrity
);

/**
 * @openapi
 * /api/admin/audit/archive/search:
 *   get:
 *     summary: Search archived audit logs
 *     description: Admin-only endpoint to search audit logs in cold storage
 *     tags: [Admin, Audit]
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for search
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for search
 *     responses:
 *       200:
 *         description: Archive search results
 */
router.get('/archive/search', auditController.searchArchive);

module.exports = router;