class AppError extends Error {
    constructor(message, statusCode = 500, options = {}) {
        super(message);

        this.name = 'AppError';
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = options.isOperational ?? true;
        this.details = options.details;

        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;
