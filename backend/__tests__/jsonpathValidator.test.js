const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validatePath,
    validateFilter,
    validateFilters,
    MAX_PATH_LENGTH,
    MAX_FILTERS_PER_TRIGGER,
} = require('../src/utils/jsonpathValidator');

test('validatePath accepts standard paths', () => {
    assert.equal(validatePath('$.value.amount').ok, true);
    assert.equal(validatePath('$.events[0].payload').ok, true);
    assert.equal(validatePath("$.data['key']").ok, true);
    assert.equal(validatePath('$..author').ok, true);
    assert.equal(validatePath('$.items[?(@.price > 10)]').ok, true);
});

test('validatePath rejects non-string input', () => {
    assert.equal(validatePath(null).ok, false);
    assert.equal(validatePath(123).ok, false);
    assert.equal(validatePath(undefined).ok, false);
});

test('validatePath rejects empty path', () => {
    assert.equal(validatePath('').ok, false);
    assert.equal(validatePath('   ').ok, false);
});

test('validatePath rejects paths over max length', () => {
    const longPath = '$.' + 'a'.repeat(MAX_PATH_LENGTH);
    const result = validatePath(longPath);
    assert.equal(result.ok, false);
    assert.match(result.error, /max length/);
});

test('validatePath requires root $', () => {
    const result = validatePath('foo.bar');
    assert.equal(result.ok, false);
    assert.match(result.error, /must start with \$/);
});

test('validatePath rejects regex patterns (ReDoS prevention)', () => {
    const result = validatePath('$.items[?(@.name=/bad/)]');
    assert.equal(result.ok, false);
    assert.match(result.error, /Regular expressions|disallowed characters/);
});

test('validatePath rejects paths with slashes (regex delimiters)', () => {
    const result = validatePath('$.items[?(@.name =~ /(a+)+/)]');
    assert.equal(result.ok, false);
});

test('validatePath rejects recursive wildcard', () => {
    const result = validatePath('$..*');
    assert.equal(result.ok, false);
    assert.match(result.error, /Recursive wildcard/);
});

test('validatePath rejects eval-like patterns', () => {
    assert.equal(validatePath('$.foo.eval(bar)').ok, false);
    assert.equal(validatePath('$.foo.Function(bar)').ok, false);
    assert.equal(validatePath('$.foo.require(bar)').ok, false);
    assert.equal(validatePath('$.process.env').ok, false);
});

test('validatePath rejects unbalanced brackets', () => {
    assert.equal(validatePath('$.items[0').ok, false);
    assert.equal(validatePath('$.items0]').ok, false);
});

test('validatePath rejects unbalanced parentheses', () => {
    assert.equal(validatePath('$.items[?(@.x > 1]').ok, false);
});

test('validateFilter accepts valid filter shapes', () => {
    assert.equal(validateFilter({ path: '$.a', operator: 'eq', value: 1 }).ok, true);
    assert.equal(validateFilter({ path: '$.a', operator: 'exists' }).ok, true);
    assert.equal(validateFilter({ path: '$.a', operator: 'in', value: [1, 2] }).ok, true);
});

test('validateFilter rejects unknown operators', () => {
    const result = validateFilter({ path: '$.a', operator: 'weird', value: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error, /not supported/);
});

test('validateFilter requires array for "in" operator', () => {
    const result = validateFilter({ path: '$.a', operator: 'in', value: 'not-an-array' });
    assert.equal(result.ok, false);
    assert.match(result.error, /requires an array/);
});

test('validateFilter requires value for comparison operators', () => {
    const result = validateFilter({ path: '$.a', operator: 'eq' });
    assert.equal(result.ok, false);
    assert.match(result.error, /requires a value/);
});

test('validateFilters accepts empty/nullish input', () => {
    assert.equal(validateFilters(undefined).ok, true);
    assert.equal(validateFilters(null).ok, true);
    assert.equal(validateFilters([]).ok, true);
});

test('validateFilters rejects non-array', () => {
    const result = validateFilters({ not: 'an-array' });
    assert.equal(result.ok, false);
});

test('validateFilters enforces max filter count', () => {
    const many = Array.from({ length: MAX_FILTERS_PER_TRIGGER + 1 }, () => ({
        path: '$.a',
        operator: 'exists',
    }));
    const result = validateFilters(many);
    assert.equal(result.ok, false);
    assert.match(result.error, /too many filters/);
});

test('validateFilters reports index of failing filter', () => {
    const filters = [
        { path: '$.a', operator: 'eq', value: 1 },
        { path: '$..*', operator: 'exists' },
    ];
    const result = validateFilters(filters);
    assert.equal(result.ok, false);
    assert.match(result.error, /filters\[1\]/);
});
