const test = require('node:test');
const assert = require('node:assert/strict');

const AppError = require('../src/utils/appError');
const asyncHandler = require('../src/utils/asyncHandler');
const {
    errorHandler,
    notFoundHandler,
} = require('../src/middleware/error.middleware');

const createResponse = () => {
    const response = {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };

    return response;
};

test('asyncHandler forwards rejected async errors to next', async () => {
    const failure = new Error('Boom');
    let forwardedError;

    const handler = asyncHandler(async () => {
        throw failure;
    });

    await handler({}, {}, (error) => {
        forwardedError = error;
    });

    assert.equal(forwardedError, failure);
});

test('notFoundHandler creates a 404 AppError', () => {
    let forwardedError;

    notFoundHandler({ originalUrl: '/missing' }, {}, (error) => {
        forwardedError = error;
    });

    assert.ok(forwardedError instanceof AppError);
    assert.equal(forwardedError.statusCode, 404);
    assert.equal(forwardedError.message, 'Route /missing not found');
});

test('errorHandler includes stack traces outside production', () => {
    process.env.NODE_ENV = 'development';
    const response = createResponse();

    errorHandler(new AppError('Validation failed', 400), {}, response, () => {});

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, 'Validation failed');
    assert.match(response.body.stack, /AppError/);
});

test('errorHandler hides internal details in production for unexpected errors', () => {
    process.env.NODE_ENV = 'production';
    const response = createResponse();

    errorHandler(new Error('Database exploded'), {}, response, () => {});

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, 'Something went wrong');
    assert.equal(response.body.stack, undefined);
});

test('errorHandler maps duplicate key database errors to a 400 response', () => {
    process.env.NODE_ENV = 'production';
    const response = createResponse();

    errorHandler(
        {
            code: 11000,
            keyValue: {
                contractId: 'duplicate-contract',
            },
        },
        {},
        response,
        () => {}
    );

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, 'Duplicate field value entered');
    assert.deepEqual(response.body.details, {
        contractId: 'duplicate-contract',
    });
});
