const logger = require('../config/logger');

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
    const start = Date.now();

    // Log request
    logger.info('Request received', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
    });

    // Log response
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('Request completed', {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
        });
    });

    next();
};

/**
 * Error logging middleware
 */
const errorLogger = (err, req, res, next) => {
    logger.error('Request error', {
        method: req.method,
        url: req.url,
        error: err.message,
        stack: err.stack,
        ip: req.ip,
    });
    next(err);
};

module.exports = {
    requestLogger,
    errorLogger,
};