const { JSONPath } = require('jsonpath-plus');
const { validateFilter } = require('./jsonpathValidator');

const EVALUATION_TIMEOUT_MS = 50;

function queryPath(path, event) {
    const start = Date.now();
    const result = JSONPath({
        path,
        json: event,
        preventEval: true,
        wrap: true,
    });
    const elapsed = Date.now() - start;
    if (elapsed > EVALUATION_TIMEOUT_MS) {
        throw new Error(`JSONPath evaluation exceeded ${EVALUATION_TIMEOUT_MS}ms budget`);
    }
    return Array.isArray(result) ? result : [result];
}

function compareNumbers(actual, expected) {
    const a = Number(actual);
    const b = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return { a, b };
}

function applyOperator(operator, actual, expected) {
    switch (operator) {
        case 'eq':
            return actual === expected || String(actual) === String(expected);
        case 'neq':
            return actual !== expected && String(actual) !== String(expected);
        case 'gt': {
            const nums = compareNumbers(actual, expected);
            return nums ? nums.a > nums.b : false;
        }
        case 'gte': {
            const nums = compareNumbers(actual, expected);
            return nums ? nums.a >= nums.b : false;
        }
        case 'lt': {
            const nums = compareNumbers(actual, expected);
            return nums ? nums.a < nums.b : false;
        }
        case 'lte': {
            const nums = compareNumbers(actual, expected);
            return nums ? nums.a <= nums.b : false;
        }
        case 'contains':
            if (Array.isArray(actual)) {
                return actual.some((v) => v === expected || String(v) === String(expected));
            }
            if (typeof actual === 'string') {
                return actual.includes(String(expected));
            }
            if (actual && typeof actual === 'object') {
                return Object.prototype.hasOwnProperty.call(actual, expected);
            }
            return false;
        case 'in':
            if (!Array.isArray(expected)) return false;
            return expected.some((v) => v === actual || String(v) === String(actual));
        case 'exists':
            return actual !== undefined && actual !== null;
        default:
            return false;
    }
}

function evaluateFilter(filter, event) {
    const validation = validateFilter(filter);
    if (!validation.ok) {
        return false;
    }

    let matches;
    try {
        matches = queryPath(filter.path, event);
    } catch (err) {
        return false;
    }

    if (filter.operator === 'exists') {
        const hasMatch = matches.length > 0 && matches.some((v) => v !== undefined && v !== null);
        return filter.value === false ? !hasMatch : hasMatch;
    }

    if (matches.length === 0) {
        return false;
    }

    return matches.some((actual) => applyOperator(filter.operator, actual, filter.value));
}

function passesFilters(event, filters) {
    if (!filters || filters.length === 0) {
        return true;
    }
    if (!Array.isArray(filters)) {
        return false;
    }
    return filters.every((filter) => evaluateFilter(filter, event));
}

module.exports = {
    passesFilters,
    evaluateFilter,
    EVALUATION_TIMEOUT_MS,
};
