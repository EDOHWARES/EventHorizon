const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const logDir = path.join(__dirname, '..', 'logs', 'tmp-logs');
process.env.LOG_DIR = logDir;
process.env.LOG_LEVEL = 'debug';
process.env.LOG_RETENTION_DAYS = '1d';

try {
  fs.rmSync(logDir, { recursive: true, force: true });
} catch (err) {
  // ignore
}
fs.mkdirSync(logDir, { recursive: true });

const logger = require('../src/config/logger');

test('backend logger writes structured JSON logs to file', async () => {
  logger.info('Logger test entry', { testId: 'elk-pipeline' });

  await new Promise((resolve) => setTimeout(resolve, 200));

  const files = fs.readdirSync(logDir).filter((file) => file.startsWith('eventhorizon-') && file.endsWith('.log'));
  assert.ok(files.length > 0, 'Expected at least one log file');

  const latestFile = path.join(logDir, files[0]);
  const content = fs.readFileSync(latestFile, 'utf8').trim();
  const lines = content.split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Expected log file to contain entries');

  const entry = JSON.parse(lines[lines.length - 1]);
  assert.equal(entry.message, 'Logger test entry');
  assert.equal(entry.level, 'info');
  assert.equal(entry.testId, 'elk-pipeline');
});
