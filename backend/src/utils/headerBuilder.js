const jp = require('jsonpath-plus');
const logger = require('../config/logger');

/**
 * Build HTTP headers from trigger configuration and event payload
 * @param {Array} customHeaders - Array of header objects with key and value
 * @param {Object} eventPayload - The event payload for JSONPath resolution
 * @returns {Object} - HTTP headers object
 */
function buildHeaders(customHeaders, eventPayload) {
    const headers = {};

    // Validate input
    if (!Array.isArray(customHeaders)) {
        logger.warn('customHeaders is not an array, returning empty headers');
        return headers;
    }

    // Process each header
    for (const header of customHeaders) {
        try {
            // Validate header structure
            if (!header || typeof header !== 'object' || !header.key || typeof header.key !== 'string') {
                logger.warn('Invalid header configuration, skipping', { header });
                continue;
            }

            const key = header.key.trim();
            if (!key) {
                logger.warn('Header key is empty, skipping', { header });
                continue;
            }

            // Skip unsafe headers
            const unsafeHeaders = ['host', 'content-length', 'content-type', 'user-agent', 'authorization'];
            if (unsafeHeaders.includes(key.toLowerCase())) {
                logger.warn('Attempted to set unsafe header, skipping', { key });
                continue;
            }

            // Validate header key format
            if (!/^[_a-zA-Z0-9-]+$/.test(key)) {
                logger.warn('Invalid header key format, skipping', { key });
                continue;
            }

            // Resolve value (static or dynamic)
            let value = '';
            if (header.value && typeof header.value === 'string') {
                value = header.value.trim();
                
                // Check if it's a JSONPath expression
                if (value.startsWith('$.')) {
                    try {
                        // Resolve JSONPath
                        const result = jp.JSONPath({ path: value, json: eventPayload });
                        
                        // Handle result
                        if (Array.isArray(result) && result.length === 1) {
                            // Single value result
                            value = String(result[0]);
                        } else if (Array.isArray(result) && result.length > 1) {
                            // Multiple values - join with comma
                            value = result.map(String).join(',');
                        } else if (result === false) {
                            // Path not found
                            logger.warn('JSONPath not found in payload, using empty value', { path: value });
                            value = '';
                        } else {
                            // Other scalar result
                            value = String(result);
                        }
                    } catch (error) {
                        logger.error('Error resolving JSONPath, using empty value', {
                            path: value,
                            error: error.message
                        });
                        value = '';
                    }
                }
                // Static value - use as-is
            } else {
                // No value provided, use empty string
                value = '';
            }

            // Set header
            headers[key] = value;
        } catch (error) {
            logger.error('Error processing header, skipping', {
                header: header,
                error: error.message
            });
        }
    }

    return headers;
}

/**
 * Validate header configuration
 * @param {Array} headers - Array of header objects to validate
 * @returns {Object} - Validation result with ok boolean and error message
 */
function validateHeaders(headers) {
    if (!Array.isArray(headers)) {
        return { ok: false, error: 'headers must be an array' };
    }

    const unsafeHeaders = ['host', 'content-length', 'content-type', 'user-agent', 'authorization'];

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        
        if (!header || typeof header !== 'object') {
            return { ok: false, error: `headers[${i}] must be an object` };
        }

        if (!header.key || typeof header.key !== 'string') {
            return { ok: false, error: `headers[${i}].key must be a non-empty string` };
        }

        const key = header.key.trim();
        if (!key) {
            return { ok: false, error: `headers[${i}].key must be a non-empty string` };
        }

        if (unsafeHeaders.includes(key.toLowerCase())) {
            return { ok: false, error: `headers[${i}].key '${key}' is not allowed` };
        }

        if (!/^[_a-zA-Z0-9-]+$/.test(key)) {
            return { ok: false, error: `headers[${i}].key '${key}' contains invalid characters` };
        }

        if (header.value === undefined || header.value === null) {
            return { ok: false, error: `headers[${i}].value is required` };
        }

        if (typeof header.value !== 'string') {
            return { ok: false, error: `headers[${i}].value must be a string` };
        }
    }

    // Limit number of headers
    if (headers.length > 50) {
        return { ok: false, error: 'too many headers (max 50)' };
    }

    return { ok: true };
}

module.exports = {
    buildHeaders,
    validateHeaders
};