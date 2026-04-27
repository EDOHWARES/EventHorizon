const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logDirectory = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const retentionDays = process.env.LOG_RETENTION_DAYS || '30d';

fs.mkdirSync(logDirectory, { recursive: true });

const jsonFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

const logger = createLogger({
  level: logLevel,
  defaultMeta: { service: 'eventhorizon-backend' },
  format: jsonFormat,
  transports: [
    new transports.Console({
      level: logLevel,
      format: jsonFormat,
    }),
    new DailyRotateFile({
      dirname: logDirectory,
      filename: 'eventhorizon-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: retentionDays,
      level: logLevel,
      format: jsonFormat,
    }),
    new DailyRotateFile({
      dirname: logDirectory,
      filename: 'eventhorizon-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: retentionDays,
      level: 'error',
      format: jsonFormat,
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
