const { Pool } = require('pg');
const logger = require('./logger');

let pool = null;

/**
 * Returns the shared TimescaleDB connection pool.
 * Lazily initialised on first call so the rest of the app can start
 * even when TIMESCALE_URL is not configured.
 */
function getPool() {
    if (pool) return pool;

    const connectionString = process.env.TIMESCALE_URL;
    if (!connectionString) {
        throw new Error(
            'TIMESCALE_URL is not set. ' +
            'Set it to a valid PostgreSQL/TimescaleDB connection string to enable execution log persistence.'
        );
    }

    pool = new Pool({
        connectionString,
        max: parseInt(process.env.TIMESCALE_POOL_MAX || '10', 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ssl: process.env.TIMESCALE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', (err) => {
        logger.error('TimescaleDB pool error', { error: err.message });
    });

    return pool;
}

/**
 * Verify connectivity and return the pool.
 * Called during server startup so misconfiguration surfaces early.
 */
async function connect() {
    const p = getPool();
    const client = await p.connect();
    try {
        await client.query('SELECT 1');
        logger.info('Connected to TimescaleDB', {
            database: 'TimescaleDB',
            status: 'connected',
        });
    } finally {
        client.release();
    }
    return p;
}

/**
 * Gracefully drain the pool (called on SIGTERM).
 */
async function disconnect() {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('TimescaleDB pool closed');
    }
}

module.exports = { getPool, connect, disconnect };
