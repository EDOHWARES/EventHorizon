const AppError = require('../utils/appError');

const isDevelopment = () => process.env.NODE_ENV !== 'production';

const normalizeError = (error) => {
    if (error instanceof AppError) {
        return error;
    }

    if (error.code === 11000) {
        return new AppError('Duplicate field value entered', 400, {
            details: error.keyValue,
        });
    }

    if (error.name === 'ValidationError') {
        const details = Object.values(error.errors || {}).map((detail) => detail.message);
        return new AppError('Validation failed', 400, { details });
    }

    if (error.name === 'CastError') {
        return new AppError(`Invalid ${error.path}: ${error.value}`, 400);
    }

    if (error.code === 'WEBHOOK_DESTINATION_BLOCKED') {
        return new AppError(error.message, error.statusCode, {
            details: error.details,
            isOperational: true,
        });
    }

    return new AppError(
        isDevelopment() && error.message ? error.message : 'Something went wrong',
        500,
        { isOperational: false }
    );
};

const notFoundHandler = (req, _res, next) => {
    next(new AppError(`Route ${req.originalUrl} not found`, 404));
};

const errorHandler = (error, _req, res, _next) => {
    const normalizedError = normalizeError(error);
    const response = {
        success: false,
        status: normalizedError.status,
        message: normalizedError.message,
    };

    if (normalizedError.details) {
        response.details = normalizedError.details;
    }

    if (isDevelopment()) {
        response.stack = normalizedError.stack;
    }

    res.status(normalizedError.statusCode || 500).json(response);
};

module.exports = {
    errorHandler,
    notFoundHandler,
};
