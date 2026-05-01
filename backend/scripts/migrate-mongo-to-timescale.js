/**
 * migrate-mongo-to-timescale.js
 *
 * One-time migration worker that reads historical execution data from MongoDB
 * (trigger.totalExecutions / failedExecutions counters and lastSuccessAt) and
 * synthesises representative rows in TimescaleDB so that trend queries have
 * historical context.
 *
 * Because MongoDB only stores aggregate counters (not individual execution
 * events), this script creates a single summary row per trigger per day
 * covering the period from the trigger's creation date up to now.
 *
 * Usage:
 *   node scripts/migrate-mongo-to-timescale.js [--dry-run]
 *
 * Options:
 *   --dry-run   Print what would be inserted without writing to TimescaleDB.
 *   --batch     Number of triggers to process per batch (default: 50).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { Pool } = require('pg');

// ── CLI flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = (() => {
    const idx = args.indexOf('--batch');
    return idx !== -1 ? parseInt(args[idx + 1], 10) || 50 : 50;
})();

// ── Connections ────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
const TIMESCALE_URL = process.env.TIMESCALE_URL;

if (!MONGO_URI) { console.error('❌  MONGO_URI is not set'); process.exit(1); }
if (!TIMESCALE_URL && !DRY_RUN) { console.error('❌  TIMESCALE_URL is not set'); process.exit(1); }

const pgPool = DRY_RUN ? null : new Pool({
    connectionString: TIMESCALE_URL,
    ssl: process.env.TIMESCALE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ── Minimal Trigger schema (read-only) ────────────────────────────────────
const triggerSchema = new mongoose.Schema({
    organization:     mongoose.Schema.Types.ObjectId,
    contractId:       String,
    eventName:        String,
    actionType:       String,
    network:          { type: String, default: 'testnet' },
    totalExecutions:  { type: Number, default: 0 },
    failedExecutions: { type: Number, default: 0 },
    lastSuccessAt:    Date,
    createdAt:        Date,
}, { timestamps: true });

const Trigger = mongoose.models.Trigger || mongoose.model('Trigger', triggerSchema);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Distribute `total` executions across `days` days, returning an array of
 * per-day counts that sum to `total`.
 */
function distributeAcrossDays(total, days) {
    if (days <= 0 || total <= 0) return [];
    const base = Math.floor(total / days);
    const remainder = total % days;
    return Array.from({ length: days }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Insert a batch of rows into TimescaleDB using a single multi-row INSERT.
 */
async function insertRows(client, rows) {
    if (rows.length === 0) return;

    const placeholders = rows.map((_, i) => {
        const base = i * 14;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`;
    }).join(',');

    const values = rows.flatMap(r => [
        r.executed_at,
        r.trigger_id,
        r.organization_id,
        r.network,
        r.contract_id,
        r.event_name,
        r.action_type,
        r.status,
        r.duration_ms,
        r.attempt_number,
        r.is_batch,
        r.batch_size,
        r.batch_successful,
        r.batch_failed,
    ]);

    await client.query(
        `INSERT INTO execution_logs (
            executed_at, trigger_id, organization_id, network,
            contract_id, event_name, action_type,
            status, duration_ms, attempt_number,
            is_batch, batch_size, batch_successful, batch_failed
        ) VALUES ${placeholders}
        ON CONFLICT DO NOTHING`,
        values
    );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function migrate() {
    console.log(`\n🚀  Starting MongoDB → TimescaleDB execution log migration`);
    console.log(`    Mode     : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
    console.log(`    Batch    : ${BATCH_SIZE} triggers\n`);

    await mongoose.connect(MONGO_URI);
    console.log('✅  Connected to MongoDB');

    const pgClient = DRY_RUN ? null : await pgPool.connect();
    if (pgClient) console.log('✅  Connected to TimescaleDB\n');

    let totalTriggers = 0;
    let totalRowsInserted = 0;
    let offset = 0;

    try {
        while (true) {
            const triggers = await Trigger.find({})
                .skip(offset)
                .limit(BATCH_SIZE)
                .lean();

            if (triggers.length === 0) break;

            const rows = [];

            for (const trigger of triggers) {
                totalTriggers++;

                const total = trigger.totalExecutions || 0;
                const failed = trigger.failedExecutions || 0;
                const successful = total - failed;

                if (total === 0) continue; // nothing to migrate

                const createdAt = trigger.createdAt || new Date(Date.now() - 30 * 24 * 3600 * 1000);
                const endDate = trigger.lastSuccessAt || new Date();
                const msPerDay = 24 * 3600 * 1000;
                const days = Math.max(1, Math.ceil((endDate - createdAt) / msPerDay));

                const successCounts = distributeAcrossDays(successful, days);
                const failureCounts = distributeAcrossDays(failed, days);

                for (let d = 0; d < days; d++) {
                    const dayDate = new Date(createdAt.getTime() + d * msPerDay);
                    dayDate.setHours(12, 0, 0, 0); // noon UTC

                    if (successCounts[d] > 0) {
                        rows.push({
                            executed_at:    dayDate,
                            trigger_id:     String(trigger._id),
                            organization_id: String(trigger.organization),
                            network:        trigger.network || 'testnet',
                            contract_id:    trigger.contractId,
                            event_name:     trigger.eventName,
                            action_type:    trigger.actionType || 'webhook',
                            status:         'success',
                            duration_ms:    null,
                            attempt_number: 1,
                            is_batch:       false,
                            batch_size:     null,
                            batch_successful: null,
                            batch_failed:   null,
                        });
                    }

                    if (failureCounts[d] > 0) {
                        rows.push({
                            executed_at:    new Date(dayDate.getTime() + 3600 * 1000),
                            trigger_id:     String(trigger._id),
                            organization_id: String(trigger.organization),
                            network:        trigger.network || 'testnet',
                            contract_id:    trigger.contractId,
                            event_name:     trigger.eventName,
                            action_type:    trigger.actionType || 'webhook',
                            status:         'failure',
                            duration_ms:    null,
                            attempt_number: 1,
                            is_batch:       false,
                            batch_size:     null,
                            batch_successful: null,
                            batch_failed:   null,
                        });
                    }
                }
            }

            if (DRY_RUN) {
                console.log(`  [dry-run] batch offset=${offset}: would insert ${rows.length} rows for ${triggers.length} triggers`);
            } else {
                await insertRows(pgClient, rows);
                console.log(`  ✅  batch offset=${offset}: inserted ${rows.length} rows for ${triggers.length} triggers`);
            }

            totalRowsInserted += rows.length;
            offset += BATCH_SIZE;
        }
    } finally {
        if (pgClient) pgClient.release();
        await mongoose.disconnect();
        if (pgPool) await pgPool.end();
    }

    console.log(`\n🎉  Migration complete`);
    console.log(`    Triggers processed : ${totalTriggers}`);
    console.log(`    Rows ${DRY_RUN ? 'would be ' : ''}inserted  : ${totalRowsInserted}\n`);
}

migrate().catch((err) => {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
});
