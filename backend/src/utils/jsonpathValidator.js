const MAX_PATH_LENGTH = 200;
const MAX_FILTERS_PER_TRIGGER = 20;

const VALID_OPERATORS = new Set([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'in',
    'exists',
]);

const PATH_ALLOWED_CHARS = /^[A-Za-z0-9_$@.\[\]'"*\s,:?()=!<>&|+-]+$/;

const FORBIDDEN_PATTERNS = [
    { pattern: /\/[^\/]*\//, message: 'Regular expressions in JSONPath are not allowed' },
    { pattern: /\$\.\.(\*|$|[^\w])/, message: 'Recursive wildcard ($..*) is not allowed' },
    { pattern: /\.\.\.\.+/, message: 'Excessive recursive descent is not allowed' },
    { pattern: /eval\s*\(/i, message: 'eval() calls are not allowed' },
    { pattern: /Function\s*\(/, message: 'Function constructor is not allowed' },
    { pattern: /require\s*\(/i, message: 'require() calls are not allowed' },
    { pattern: /process\./i, message: 'Access to process is not allowed' },
];

function validatePath(rawPath) {
    if (typeof rawPath !== 'string') {
        return { ok: false, error: 'path must be a string' };
    }

    const path = rawPath.trim();

    if (path.length === 0) {
        return { ok: false, error: 'path cannot be empty' };
    }

    if (path.length > MAX_PATH_LENGTH) {
        return { ok: false, error: `path exceeds max length of ${MAX_PATH_LENGTH}` };
    }

    if (!path.startsWith('$')) {
        return { ok: false, error: 'path must start with $' };
    }

    if (!PATH_ALLOWED_CHARS.test(path)) {
        return { ok: false, error: 'path contains disallowed characters' };
    }

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
        if (pattern.test(path)) {
            return { ok: false, error: message };
        }
    }

    const openBrackets = (path.match(/\[/g) || []).length;
    const closeBrackets = (path.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
        return { ok: false, error: 'path has unbalanced brackets' };
    }

    const openParens = (path.match(/\(/g) || []).length;
    const closeParens = (path.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
        return { ok: false, error: 'path has unbalanced parentheses' };
    }

    return { ok: true };
}

function validateFilter(filter) {
    if (!filter || typeof filter !== 'object') {
        return { ok: false, error: 'filter must be an object' };
    }

    const pathResult = validatePath(filter.path);
    if (!pathResult.ok) {
        return pathResult;
    }

    if (!VALID_OPERATORS.has(filter.operator)) {
        return { ok: false, error: `operator "${filter.operator}" is not supported` };
    }

    if (filter.operator === 'in' && !Array.isArray(filter.value)) {
        return { ok: false, error: 'operator "in" requires an array value' };
    }

    if (filter.operator !== 'exists' && filter.operator !== 'in' && filter.value === undefined) {
        return { ok: false, error: `operator "${filter.operator}" requires a value` };
    }

    return { ok: true };
}

function validateFilters(filters) {
    if (filters === undefined || filters === null) {
        return { ok: true };
    }

    if (!Array.isArray(filters)) {
        return { ok: false, error: 'filters must be an array' };
    }

    if (filters.length > MAX_FILTERS_PER_TRIGGER) {
        return { ok: false, error: `too many filters (max ${MAX_FILTERS_PER_TRIGGER})` };
    }

    for (let i = 0; i < filters.length; i++) {
        const result = validateFilter(filters[i]);
        if (!result.ok) {
            return { ok: false, error: `filters[${i}]: ${result.error}` };
        }
    }

    return { ok: true };
}

module.exports = {
    validatePath,
    validateFilter,
    validateFilters,
    MAX_PATH_LENGTH,
    MAX_FILTERS_PER_TRIGGER,
    VALID_OPERATORS,
};
