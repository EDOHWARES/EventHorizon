const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

const logsDir = path.join(__dirname, '../../logs');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    winston.format.json()
);

const logger = winston.createLogger({
    levels: LOG_LEVELS,
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'event-horizon-backend' },
    format: jsonFormat,
    transports: [
        new DailyRotateFile({
            filename: path.join(logsDir, 'application-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
        }),
        new DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '30d',
            level: 'error',
        }),
    ],
});

logger.add(
    new winston.transports.Console({
        format: jsonFormat,
    })
);

module.exports = logger;
