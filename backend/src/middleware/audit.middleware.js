const AuditLog = require('../models/audit.model');
const logger = require('../config/logger');

/**
 * Audit middleware for tracking trigger operations
 * Intercepts all write operations and logs them for compliance
 */
class AuditMiddleware {
    constructor() {
        this.operationMap = {
            POST: 'CREATE',
            PUT: 'UPDATE',
            PATCH: 'UPDATE',
            DELETE: 'DELETE'
        };
    }

    /**
     * Extract user identifier from request
     */
    getUserIdentifier(req) {
        return req.user ? req.user.id : null;
    }

    /**
     * Calculate diff between old and new objects
     */
    calculateDiff(oldObj, newObj) {
        const diff = [];
        const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

        for (const key of allKeys) {
            const oldValue = oldObj ? oldObj[key] : undefined;
            const newValue = newObj ? newObj[key] : undefined;

            // Deep comparison for objects
            const oldStr = JSON.stringify(oldValue);
            const newStr = JSON.stringify(newValue);

            if (oldStr !== newStr) {
                diff.push({
                    field: key,
                    oldValue,
                    newValue
                });
            }
        }

        return diff;
    }

    /**
     * Create audit log entry
     */
    async createAuditLog(operation, resourceId, req, changes = null) {
        try {
            const userId = this.getUserIdentifier(req);
            const ipAddress = req.ip || req.connection.remoteAddress;
            const forwardedFor = req.get('X-Forwarded-For');

            const metadata = {
                endpoint: req.originalUrl,
                method: req.method,
                userAgent: req.get('User-Agent'),
                sessionId: req.sessionID,
                requestId: req.id || req.requestId
            };

            await AuditLog.createLog({
                operation,
                resourceType: 'Trigger',
                resourceId,
                organization: req.user.organization._id,
                userId,
                userAgent: req.get('User-Agent'),
                ipAddress,
                forwardedFor,
                changes,
                metadata
            });

            logger.info('Audit log created', {
                operation,
                resourceId,
                userId,
                ipAddress
            });

        } catch (error) {
            logger.error('Failed to create audit log', {
                operation,
                resourceId,
                error: error.message,
                stack: error.stack
            });
            // Don't throw - audit logging failure shouldn't break the operation
        }
    }

    /**
     * Middleware for CREATE operations
     */
    auditCreate() {
        return async (req, res, next) => {
            // Store original request for audit logging
            req._auditData = {
                operation: 'CREATE',
                startTime: Date.now()
            };

            // Override res.json to capture the created resource
            const originalJson = res.json;
            res.json = function(data) {
                if (data && data.success && data.data && data.data._id) {
                    // Async audit logging (don't await to avoid blocking response)
                    this._auditData.resourceId = data.data._id;
                    this._auditData.changes = {
                        before: null,
                        after: data.data,
                        diff: [] // New resource, no diff
                    };
                }
                return originalJson.call(this, data);
            }.bind(req);

            // Log after response is sent
            res.on('finish', () => {
                if (req._auditData.resourceId) {
                    this.createAuditLog(
                        req._auditData.operation,
                        req._auditData.resourceId,
                        req,
                        req._auditData.changes
                    );
                }
            });

            next();
        };
    }

    /**
     * Middleware for UPDATE operations
     */
    auditUpdate() {
        return async (req, res, next) => {
            const resourceId = req.params.id;

            if (!resourceId) {
                logger.warn('Audit middleware: No resource ID found for update operation');
                return next();
            }

            req._auditData = {
                operation: 'UPDATE',
                resourceId,
                startTime: Date.now()
            };

            try {
                // Get the current state before update
                const Trigger = require('../models/trigger.model');
                const beforeState = await Trigger.findById(resourceId);

                if (beforeState) {
                    req._auditData.beforeState = beforeState.toObject();
                }
            } catch (error) {
                logger.warn('Failed to capture before state for audit', {
                    resourceId,
                    error: error.message
                });
            }

            // Override res.json to capture the updated resource
            const originalJson = res.json;
            res.json = function(data) {
                if (data && data.success && data.data) {
                    const afterState = data.data;
                    const changes = {
                        before: req._auditData.beforeState,
                        after: afterState,
                        diff: this._auditData.beforeState ?
                            this.calculateDiff(req._auditData.beforeState, afterState) : []
                    };
                    req._auditData.changes = changes;
                }
                return originalJson.call(this, data);
            }.bind(req);

            // Log after response is sent
            res.on('finish', () => {
                if (req._auditData.changes) {
                    this.createAuditLog(
                        req._auditData.operation,
                        req._auditData.resourceId,
                        req,
                        req._auditData.changes
                    );
                }
            });

            next();
        };
    }

    /**
     * Middleware for DELETE operations
     */
    auditDelete() {
        return async (req, res, next) => {
            const resourceId = req.params.id;

            if (!resourceId) {
                logger.warn('Audit middleware: No resource ID found for delete operation');
                return next();
            }

            req._auditData = {
                operation: 'DELETE',
                resourceId,
                startTime: Date.now()
            };

            try {
                // Get the current state before deletion
                const Trigger = require('../models/trigger.model');
                const beforeState = await Trigger.findById(resourceId);

                if (beforeState) {
                    req._auditData.changes = {
                        before: beforeState.toObject(),
                        after: null,
                        diff: [] // Deletion, no diff to calculate
                    };
                }
            } catch (error) {
                logger.warn('Failed to capture before state for delete audit', {
                    resourceId,
                    error: error.message
                });
            }

            // Log after response is sent
            res.on('finish', () => {
                this.createAuditLog(
                    req._auditData.operation,
                    req._auditData.resourceId,
                    req,
                    req._auditData.changes
                );
            });

            next();
        };
    }

    /**
     * Generic audit middleware that determines operation type
     */
    audit() {
        return (req, res, next) => {
            const operation = this.operationMap[req.method];

            if (!operation) {
                return next(); // Not a write operation
            }

            switch (operation) {
                case 'CREATE':
                    return this.auditCreate()(req, res, next);
                case 'UPDATE':
                    return this.auditUpdate()(req, res, next);
                case 'DELETE':
                    return this.auditDelete()(req, res, next);
                default:
                    next();
            }
        };
    }
}

// Export singleton instance
module.exports = new AuditMiddleware();