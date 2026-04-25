const AWS = require('aws-sdk');
const { Storage } = require('@google-cloud/storage');
const mongoose = require('mongoose');
const AuditLog = require('../models/audit.model');
const logger = require('../config/logger');
const fs = require('fs');
const path = require('path');

class RetentionService {
    constructor() {
        this.s3 = null;
        this.gcs = null;
        this.retentionDays = parseInt(process.env.RETENTION_DAYS || '30');
        this.archiveProvider = process.env.ARCHIVE_PROVIDER || 's3'; // 's3' or 'gcs'
        this.bucketName = process.env.ARCHIVE_BUCKET;

        this.initializeClients();
    }

    initializeClients() {
        // S3 client
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            AWS.config.update({
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                region: process.env.AWS_REGION || 'us-east-1',
            });
            this.s3 = new AWS.S3();
        }

        // GCS client
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            this.gcs = new Storage();
        }
    }

    async archiveOldLogs() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

            logger.info('Starting data retention archiving', {
                cutoffDate,
                retentionDays: this.retentionDays,
                provider: this.archiveProvider
            });

            // Find old logs
            const oldLogs = await AuditLog.find({
                timestamp: { $lt: cutoffDate }
            }).lean(); // Use lean for better performance

            if (oldLogs.length === 0) {
                logger.info('No old logs to archive');
                return;
            }

            // Group logs by date for efficient archiving
            const logsByDate = this.groupLogsByDate(oldLogs);

            for (const [dateKey, logs] of Object.entries(logsByDate)) {
                await this.archiveLogsForDate(dateKey, logs);
            }

            // Delete archived logs from database
            const deleteResult = await AuditLog.deleteMany({
                timestamp: { $lt: cutoffDate }
            });

            logger.info('Data retention archiving completed', {
                archivedLogs: oldLogs.length,
                deletedLogs: deleteResult.deletedCount
            });

        } catch (error) {
            logger.error('Failed to archive old logs', { error: error.message });
            throw error;
        }
    }

    groupLogsByDate(logs) {
        const groups = {};
        logs.forEach(log => {
            const date = log.timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
            if (!groups[date]) groups[date] = [];
            groups[date].push(log);
        });
        return groups;
    }

    async archiveLogsForDate(dateKey, logs) {
        const filename = `audit-logs-${dateKey}.json`;
        const data = JSON.stringify(logs, null, 2);

        if (this.archiveProvider === 's3' && this.s3) {
            await this.s3.putObject({
                Bucket: this.bucketName,
                Key: filename,
                Body: data,
                ContentType: 'application/json',
            }).promise();
        } else if (this.archiveProvider === 'gcs' && this.gcs) {
            const file = this.gcs.bucket(this.bucketName).file(filename);
            await file.save(data, {
                contentType: 'application/json',
            });
        } else {
            // Fallback: save to local file
            const localPath = path.join(process.cwd(), 'archive', filename);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, data);
            logger.warn('No cloud storage configured, saved to local file', { path: localPath });
        }

        logger.info(`Archived logs for ${dateKey}`, { count: logs.length, filename });
    }

    async searchArchive(query, startDate, endDate) {
        // This is a simplified search - in production, you'd need proper indexing
        // For now, return a message indicating archive search
        logger.info('Archive search requested', { query, startDate, endDate });

        return {
            message: 'Archive search not fully implemented. Please specify date range for local search.',
            available: this.listArchivedFiles(),
        };
    }

    listArchivedFiles() {
        // Placeholder - would list files from S3/GCS
        return ['audit-logs-2024-01-01.json', 'audit-logs-2024-01-02.json'];
    }

    async cleanupExecutionHistory() {
        // Assuming there's an execution history model
        // For now, placeholder
        logger.info('Cleaning up execution history older than retention period');
        // Implement similar to audit logs
    }
}

module.exports = new RetentionService();