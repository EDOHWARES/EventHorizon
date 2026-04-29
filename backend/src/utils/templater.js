const TEMPLATE_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function getByPath(source, path) {
    if (!source || !path) return undefined;

    return path.split('.').reduce((current, segment) => {
        if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), segment)) {
            return undefined;
        }
        return current[segment];
    }, source);
}

function stringifyTemplateValue(value) {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function resolveTemplateString(value, context) {
    return value.replace(TEMPLATE_PATTERN, (match, path) => {
        const resolved = getByPath(context, path);
        return resolved === undefined ? match : stringifyTemplateValue(resolved);
    });
}

function resolveTemplates(value, context) {
    if (typeof value === 'string') {
        return resolveTemplateString(value, context);
    }

    if (Array.isArray(value)) {
        return value.map((item) => resolveTemplates(item, context));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, resolveTemplates(child, context)])
        );
    }

    return value;
}

module.exports = {
    getByPath,
    resolveTemplates,
};
