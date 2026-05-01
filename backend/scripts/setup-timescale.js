/**
 * setup-timescale.js
 *
 * Creates the execution_logs hypertable and all supporting indexes in TimescaleDB.
 * Run once before starting the server:
 *
 *   node scripts/setup-timescale.js
 *
 * Safe to re-run — all DDL statements use IF NOT EXISTS / IF EXISTS guards.
 */

require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.TIMESCALE_URL;
if (!connectionString) {
    console.error('❌  TIMESCALE_URL environment variable is not set.');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: process.env.TIMESCALE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function setup() {
    const client = await pool.connect();
    try {
        console.log('🔌  Connected to TimescaleDB');

        // ------------------------------------------------------------------ //
        // 1. TimescaleDB extension
        // ------------------------------------------------------------------ //
        await client.query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`);
        console.log('✅  timescaledb extension ready');

        // ------------------------------------------------------------------ //
        // 2. Main execution_logs table
        // ------------------------------------------------------------------ //
        await client.query(`
            CREATE TABLE IF NOT EXISTS execution_logs (
                -- Time dimension (partition key for the hypertable)
                executed_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

                -- Identity
                id                  UUID            NOT NULL DEFAULT gen_random_uuid(),
                trigger_id          TEXT            NOT NULL,
                organization_id     TEXT            NOT NULL,

                -- Execution context
                network             TEXT            NOT NULL DEFAULT 'testnet',
                contract_id         TEXT            NOT NULL,
                event_name          TEXT            NOT NULL,
                action_type         TEXT            NOT NULL,

                -- Outcome
                status              TEXT            NOT NULL CHECK (status IN ('success', 'failure', 'retrying')),
                duration_ms         INTEGER,
                attempt_number      INTEGER         NOT NULL DEFAULT 1,
                error_message       TEXT,
                error_code          TEXT,

                -- Batch metadata (NULL for single-event executions)
                is_batch            BOOLEAN         NOT NULL DEFAULT FALSE,
                batch_size          INTEGER,
                batch_successful    INTEGER,
                batch_failed        INTEGER,

                -- Ledger context
                ledger_sequence     BIGINT,

                -- Raw payload snapshot (optional, controlled by env flag)
                payload_snapshot    JSONB,

                -- Source of the log entry
                source              TEXT            NOT NULL DEFAULT 'queue'
                    CHECK (source IN ('queue', 'direct', 'migration'))
            );
        `);
        console.log('✅  execution_logs table ready');

        // ------------------------------------------------------------------ //
        // 3. Convert to hypertable (idempotent — errors if already a hypertable
        //    but we catch that gracefully)
        // ------------------------------------------------------------------ //
        try {
            await client.query(`
                SELECT create_hypertable(
                    'execution_logs',
                    'executed_at',
                    chunk_time_interval => INTERVAL '1 day',
                    if_not_exists       => TRUE
                );
            `);
            console.log('✅  execution_logs hypertable configured (1-day chunks)');
        } catch (err) {
            if (err.message.includes('already a hypertable')) {
                console.log('ℹ️   execution_logs is already a hypertable — skipping');
            } else {
                throw err;
            }
        }

        // ------------------------------------------------------------------ //
        // 4. Indexes for common query patterns
        // ------------------------------------------------------------------ //
        const indexes = [
            // Trigger-level history (most common dashboard query)
            {
                name: 'idx_exec_logs_trigger_time',
                ddl: `CREATE INDEX IF NOT EXISTS idx_exec_logs_trigger_time
                      ON execution_logs (trigger_id, executed_at DESC);`,
            },
            // Organisation-scoped queries
            {
                name: 'idx_exec_logs_org_time',
                ddl: `CREATE INDEX IF NOT EXISTS idx_exec_logs_org_time
                      ON execution_logs (organization_id, executed_at DESC);`,
            },
            // Status filtering (failure dashboards)
            {
                name: 'idx_exec_logs_status_time',
                ddl: `CREATE INDEX IF NOT EXISTS idx_exec_logs_status_time
                      ON execution_logs (status, executed_at DESC);`,
            },
            // Contract-level analytics
            {
                name: 'idx_exec_logs_contract_time',
                ddl: `CREATE INDEX IF NOT EXISTS idx_exec_logs_contract_time
                      ON execution_logs (contract_id, executed_at DESC);`,
            },
            // Network partitioning
            {
                name: 'idx_exec_logs_network_time',
                ddl: `CREATE INDEX IF NOT EXISTS idx_exec_logs_network_time
                      ON execution_logs (network, executed_at DESC);`,
            },
        ];

        for (const idx of indexes) {
            await client.query(idx.ddl);
            console.log(`✅  index ${idx.name} ready`);
        }

        // ------------------------------------------------------------------ //
        // 5. Continuous aggregate: hourly execution trends
        //    (used by the /trends endpoint)
        // ------------------------------------------------------------------ //
        await client.query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS execution_trends_hourly
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('1 hour', executed_at)  AS bucket,
                organization_id,
                trigger_id,
                network,
                action_type,
                status,
                COUNT(*)                            AS total_executions,
                AVG(duration_ms)                    AS avg_duration_ms,
                MAX(duration_ms)                    AS max_duration_ms,
                MIN(duration_ms)                    AS min_duration_ms,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
                SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failed
            FROM execution_logs
            GROUP BY bucket, organization_id, trigger_id, network, action_type, status
            WITH NO DATA;
        `);
        console.log('✅  execution_trends_hourly continuous aggregate ready');

        // Refresh policy: keep the aggregate up to date automatically
        try {
            await client.query(`
                SELECT add_continuous_aggregate_policy(
                    'execution_trends_hourly',
                    start_offset  => INTERVAL '3 hours',
                    end_offset    => INTERVAL '1 hour',
                    schedule_interval => INTERVAL '1 hour',
                    if_not_exists => TRUE
                );
            `);
            console.log('✅  continuous aggregate refresh policy set');
        } catch (err) {
            // Policy may already exist on re-runs
            if (!err.message.includes('already exists')) throw err;
            console.log('ℹ️   refresh policy already exists — skipping');
        }

        // ------------------------------------------------------------------ //
        // 6. Retention policy: drop chunks older than TIMESCALE_RETENTION_DAYS
        // ------------------------------------------------------------------ //
        const retentionDays = parseInt(process.env.TIMESCALE_RETENTION_DAYS || '90', 10);
        try {
            await client.query(`
                SELECT add_retention_policy(
                    'execution_logs',
                    INTERVAL '${retentionDays} days',
                    if_not_exists => TRUE
                );
            `);
            console.log(`✅  retention policy set to ${retentionDays} days`);
        } catch (err) {
            if (!err.message.includes('already exists')) throw err;
            console.log('ℹ️   retention policy already exists — skipping');
        }

        console.log('\n🎉  TimescaleDB setup complete.\n');
    } finally {
        client.release();
        await pool.end();
    }
}

setup().catch((err) => {
    console.error('❌  Setup failed:', err.message);
    process.exit(1);
});
