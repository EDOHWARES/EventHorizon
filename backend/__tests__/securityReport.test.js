/**
 * Tests for the security compliance report generator.
 * These tests validate the report structure and severity classification
 * logic without requiring a live Snyk token.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildReport, classifySeverity, summarize } = require('../src/utils/securityReport');

describe('securityReport', () => {
  describe('classifySeverity', () => {
    it('maps critical to critical', () => {
      assert.strictEqual(classifySeverity('critical'), 'critical');
    });

    it('maps high to high', () => {
      assert.strictEqual(classifySeverity('high'), 'high');
    });

    it('maps medium to medium', () => {
      assert.strictEqual(classifySeverity('medium'), 'medium');
    });

    it('maps low to low', () => {
      assert.strictEqual(classifySeverity('low'), 'low');
    });

    it('maps unknown strings to unknown', () => {
      assert.strictEqual(classifySeverity('info'), 'unknown');
      assert.strictEqual(classifySeverity(''), 'unknown');
    });
  });

  describe('summarize', () => {
    const vulns = [
      { severity: 'critical', id: 'SNYK-001', packageName: 'axios', title: 'SSRF' },
      { severity: 'high',     id: 'SNYK-002', packageName: 'express', title: 'ReDoS' },
      { severity: 'high',     id: 'SNYK-003', packageName: 'jsonwebtoken', title: 'Weak alg' },
      { severity: 'medium',   id: 'SNYK-004', packageName: 'lodash', title: 'Prototype pollution' },
      { severity: 'low',      id: 'SNYK-005', packageName: 'debug', title: 'Info leak' },
    ];

    it('counts severities correctly', () => {
      const s = summarize(vulns);
      assert.strictEqual(s.critical, 1);
      assert.strictEqual(s.high, 2);
      assert.strictEqual(s.medium, 1);
      assert.strictEqual(s.low, 1);
      assert.strictEqual(s.total, 5);
    });

    it('returns zero counts for empty input', () => {
      const s = summarize([]);
      assert.strictEqual(s.total, 0);
      assert.strictEqual(s.critical, 0);
    });
  });

  describe('buildReport', () => {
    it('returns a report with required fields', () => {
      const snykJson = {
        vulnerabilities: [
          { severity: 'high', id: 'SNYK-JS-001', packageName: 'axios', title: 'SSRF' },
        ],
      };
      const report = buildReport(snykJson, { project: 'backend' });

      assert.ok(report.generatedAt);
      assert.ok(report.project);
      assert.ok(report.summary);
      assert.ok(Array.isArray(report.vulnerabilities));
      assert.strictEqual(report.summary.high, 1);
      assert.strictEqual(report.summary.total, 1);
    });

    it('handles missing vulnerabilities array gracefully', () => {
      const report = buildReport({}, { project: 'backend' });
      assert.strictEqual(report.summary.total, 0);
      assert.deepStrictEqual(report.vulnerabilities, []);
    });

    it('sets compliant flag when no high/critical findings', () => {
      const snykJson = {
        vulnerabilities: [
          { severity: 'low', id: 'SNYK-001', packageName: 'debug', title: 'Info' },
        ],
      };
      const report = buildReport(snykJson, { project: 'backend' });
      assert.strictEqual(report.compliant, true);
    });

    it('sets compliant flag to false when high findings exist', () => {
      const snykJson = {
        vulnerabilities: [
          { severity: 'high', id: 'SNYK-002', packageName: 'express', title: 'ReDoS' },
        ],
      };
      const report = buildReport(snykJson, { project: 'backend' });
      assert.strictEqual(report.compliant, false);
    });
  });
});
