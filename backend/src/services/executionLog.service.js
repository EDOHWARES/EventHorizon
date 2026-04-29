/**
 * executionLog.service.js
 *
 * Thin service layer that writes execution log rows to TimescaleDB and
 * exposes optimised query helpers for the API layer.
 *
 * All writes are fire-and-forget by default (errors are logged, never thrown)
 * so a TimescaleDB outage never disrupts trigger execution.
 */

const logger = require('../config/logger');

// Lazily resolved so the module can be imported even when TIMESCALE_URL is absent
let _pool = null;

function getPool() {
    if (_pool) return _pool;
    const { getPool: resolvePool } = require('../config/timescale');
    _pool = resolvePool();
    return _pool;
}

// Whether to persist a snapshot of the raw event payload alongside the log row.
// Disabled by default to keep storage lean; enable with TIMESCALE_STORE_PAYLOAD=true.
const STORE_PAYLOAD = process.env.TIMESCALE_STORE_PAYLOAD === 'true';

// ─────────────────────────────────────────────────────────────────────────────
// Write helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a single execution log entry.
 *
 * @param {object} entry
 * @param {string}  entry.triggerId
 * @param {string}  entry.organizationId
 * @param {string}  entry.network          - e.g. 'testnet' | 'mainnet'
 * @param {string}  entry.contractId
 * @param {string}  entry.eventName
 * @param {string}  entry.actionType       - webhook | discord | email | telegram
 * @param {'success'|'failure'|'retrying'} entry.status
 * @param {number}  [entry.durationMs]
 * @param {number}  [entry.attemptNumber]
 * @param {string}  [entry.errorMessage]
 * @param {string}  [entry.errorCode]
 * @param {boolean} [entry.isBatch]
 * @param {number}  [entry.batchSize]
 * @param {number}  [entry.batchSuccessful]
 * @param {number}  [entry.batchFailed]
 * @param {number}  [entry.ledgerSequence]
 * @param {object}  [entry.payloadSnapshot]
 * @param {'queue'|'direct'|'migration'} [entry.source]
 * @param {Date}    [entry.executedAt]     - defaults to NOW()
 * @returns {Promise<void>}
 */
async function logExecution(entry) {
    try {
        const pool = getPool();

        const {
            triggerId,
            organizationId,
            network = 'testnet',
            contractId,
            eventName,
            actionType,
            status,
            durationMs = null,
            attemptNumber = 1,
            errorMessage = null,
            errorCode = null,
            isBatch = false,
            batchSize = null,
            batchSuccessful = null,
            batchFailed = null,
            ledgerSequence = null,
            payloadSnapshot = null,
            source = 'queue',
            executedAt = new Date(),
        } = entry;

        const snapshot = STORE_PAYLOAD && payloadSnapshot
            ? JSON.stringify(payloadSnapshot)
            : null;

        await pool.query(
            `INSERT INTO execution_logs (
                executed_at, trigger_id, organization_id, network,
                contract_id, event_name, action_type,
                status, duration_ms, attempt_number,
                error_message, error_code,
                is_batch, batch_size, batch_successful, batch_failed,
                ledger_sequence, payload_snapshot, source
            ) VALUES (
                $1,  $2,  $3,  $4,
                $5,  $6,  $7,
                $8,  $9,  $10,
                $11, $12,
                $13, $14, $15, $16,
                $17, $18, $19
            )`,
            [
                executedAt, triggerId, organizationId, network,
                contractId, eventName, actionType,
                status, durationMs, attemptNumber,
                errorMessage, errorCode,
                isBatch, batchSize, batchSuccessful, batchFailed,
                ledgerSequence, snapshot, source,
            ]
        );
    } catch (err) {
        // Never let a logging failure break trigger execution
        logger.error('Failed to write execution log to TimescaleDB', {
            error: err.message,
            triggerId: entry.triggerId,
        });
    }
}

/**
 * Convenience wrapper: log a successful single execution.
 */
async function logSuccess(trigger, { durationMs, attemptNumber = 1, ledgerSequence, payloadSnapshot, source = 'queue' } = {}) {
    return logExecution({
        triggerId: String(trigger._id),
        organizationId: String(trigger.organization),
        network: trigger.network || 'testnet',
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        actionType: trigger.actionType,
        status: 'success',
        durationMs,
        attemptNumber,
        ledgerSequence,
        payloadSnapshot,
        source,
    });
}

/**
 * Convenience wrapper: log a failed execution.
 */
async function logFailure(trigger, error, { durationMs, attemptNumber = 1, ledgerSequence, payloadSnapshot, source = 'queue' } = {}) {
    return logExecution({
        triggerId: String(trigger._id),
        organizationId: String(trigger.organization),
        network: trigger.network || 'testnet',
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        actionType: trigger.actionType,
        status: 'failure',
        durationMs,
        attemptNumber,
        errorMessage: error?.message || String(error),
        errorCode: error?.code || null,
        ledgerSequence,
        payloadSnapshot,
        source,
    });
}

/**
 * Convenience wrapper: log a batch execution result.
 */
async function logBatchExecution(trigger, batchResult, { durationMs, attemptNumber = 1, ledgerSequence, source = 'queue' } = {}) {
    const status = batchResult.failed === 0
        ? 'success'
        : batchResult.successful === 0
            ? 'failure'
            : 'success'; // partial success is still reported as success

    return logExecution({
        triggerId: String(trigger._id),
        organizationId: String(trigger.organization),
        network: trigger.network || 'testnet',
        contractId: trigger.contractId,
        eventName: trigger.eventName,
        actionType: trigger.actionType,
        status,
        durationMs,
        attemptNumber,
        isBatch: true,
        batchSize: batchResult.total,
        batchSuccessful: batchResult.successful,
        batchFailed: batchResult.failed,
        errorMessage: batchResult.failed > 0
            ? `${batchResult.failed}/${batchResult.total} batch events failed`
            : null,
        ledgerSequence,
        source,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Query helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch paginated execution history for a single trigger.
 *
 * @param {string} triggerId
 * @param {object} opts
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.status]   - filter by status
 * @param {Date}   [opts.from]
 * @param {Date}   [opts.to]
 * @returns {Promise<{rows: object[], total: number}>}
 */
async function getLogsForTrigger(triggerId, { limit = 50, offset = 0, status, from, to } = {}) {
    const pool = getPool();

    const conditions = ['trigger_id = $1'];
    const params = [triggerId];
    let idx = 2;

    if (status) {
        conditions.push(`status = $${idx++}`);
        params.push(status);
    }
    if (from) {
        conditions.push(`executed_at >= $${idx++}`);
        params.push(from);
    }
    if (to) {
        conditions.push(`executed_at <= $${idx++}`);
        params.push(to);
    }

    const where = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
        pool.query(
            `SELECT id, executed_at, status, duration_ms, attempt_number,
                    error_message, is_batch, batch_size, batch_successful, batch_failed,
                    ledger_sequence, action_type, source
             FROM execution_logs
             WHERE ${where}
             ORDER BY executed_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, limit, offset]
        ),
        pool.query(
            `SELECT COUNT(*) AS total FROM execution_logs WHERE ${where}`,
            params
        ),
    ]);

    return {
        rows: dataResult.rows,
        total: parseInt(countResult.rows[0].total, 10),
    };
}

/**
 * Fetch execution trends aggregated by hour for an organisation.
 * Uses the continuous aggregate when available, falls back to raw table.
 *
 * @param {string} organizationId
 * @param {object} opts
 * @param {string} [opts.triggerId]   - narrow to a single trigger
 * @param {string} [opts.network]
 * @param {Date}   [opts.from]
 * @param {Date}   [opts.to]
 * @param {string} [opts.bucketInterval='1 hour']
 * @returns {Promise<object[]>}
 */
async function getExecutionTrends(organizationId, { triggerId, network, from, to, bucketInterval = '1 hour' } = {}) {
    const pool = getPool();

    const conditions = ['organization_id = $1'];
    const params = [organizationId];
    let idx = 2;

    if (triggerId) {
        conditions.push(`trigger_id = $${idx++}`);
        params.push(triggerId);
    }
    if (network) {
        conditions.push(`network = $${idx++}`);
        params.push(network);
    }
    if (from) {
        conditions.push(`executed_at >= $${idx++}`);
        params.push(from);
    }
    if (to) {
        conditions.push(`executed_at <= $${idx++}`);
        params.push(to);
    }

    const where = conditions.join(' AND ');

    // Validate bucketInterval to prevent SQL injection (only allow safe values)
    const allowedIntervals = ['1 minute', '5 minutes', '15 minutes', '1 hour', '6 hours', '1 day'];
    const safeInterval = allowedIntervals.includes(bucketInterval) ? bucketInterval : '1 hour';

    const result = await pool.query(
        `SELECT
            time_bucket($${idx}, executed_at)   AS bucket,
            trigger_id,
            action_type,
            status,
            COUNT(*)                            AS total_executions,
            ROUND(AVG(duration_ms))             AS avg_duration_ms,
            MAX(duration_ms)                    AS max_duration_ms,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
            SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failed
         FROM execution_logs
         WHERE ${where}
         GROUP BY bucket, trigger_id, action_type, status
         ORDER BY bucket DESC`,
        [...params, `${safeInterval}`]
    );

    return result.rows;
}

/**
 * Aggregate success/failure counts for a trigger over a time window.
 * Used for health-score calculations.
 *
 * @param {string} triggerId
 * @param {number} [windowHours=24]
 * @returns {Promise<{total: number, successful: number, failed: number, successRate: number}>}
 */
async function getTriggerHealthStats(triggerId, windowHours = 24) {
    const pool = getPool();

    const result = await pool.query(
        `SELECT
            COUNT(*)                                                AS total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)   AS successful,
            SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END)   AS failed,
            ROUND(AVG(duration_ms))                                AS avg_duration_ms
         FROM execution_logs
         WHERE trigger_id = $1
           AND executed_at >= NOW() - ($2 || ' hours')::INTERVAL`,
        [triggerId, windowHours]
    );

    const row = result.rows[0];
    const total = parseInt(row.total, 10) || 0;
    const successful = parseInt(row.successful, 10) || 0;
    const failed = parseInt(row.failed, 10) || 0;

    return {
        total,
        successful,
        failed,
        successRate: total > 0 ? Math.round((successful / total) * 100) : null,
        avgDurationMs: row.avg_duration_ms ? parseInt(row.avg_duration_ms, 10) : null,
    };
}

module.exports = {
    logExecution,
    logSuccess,
    logFailure,
    logBatchExecution,
    getLogsForTrigger,
    getExecutionTrends,
    getTriggerHealthStats,
};
