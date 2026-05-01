'use strict';

/**
 * Security compliance report utilities.
 *
 * Parses Snyk JSON output (--json-file-output) and produces a structured
 * compliance report that can be stored as a CI artifact or served via API.
 */

const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

/**
 * Normalise a raw severity string from Snyk output.
 * @param {string} raw
 * @returns {'critical'|'high'|'medium'|'low'|'unknown'}
 */
function classifySeverity(raw) {
  const s = (raw || '').toLowerCase();
  return KNOWN_SEVERITIES.has(s) ? s : 'unknown';
}

/**
 * Count vulnerabilities by severity.
 * @param {Array<{severity: string}>} vulns
 * @returns {{ critical: number, high: number, medium: number, low: number, unknown: number, total: number }}
 */
function summarize(vulns) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0 };
  for (const v of vulns) {
    const s = classifySeverity(v.severity);
    counts[s]++;
    counts.total++;
  }
  return counts;
}

/**
 * Build a compliance report from a parsed Snyk JSON result.
 *
 * @param {object} snykJson   - Parsed content of snyk --json-file-output
 * @param {object} meta       - Extra metadata (e.g. { project: 'backend' })
 * @returns {object}          - Structured compliance report
 */
function buildReport(snykJson, meta = {}) {
  const vulns = Array.isArray(snykJson.vulnerabilities) ? snykJson.vulnerabilities : [];
  const summary = summarize(vulns);
  const compliant = summary.critical === 0 && summary.high === 0;

  return {
    generatedAt: new Date().toISOString(),
    project: meta.project || 'unknown',
    compliant,
    summary,
    vulnerabilities: vulns.map((v) => ({
      id: v.id,
      title: v.title,
      severity: classifySeverity(v.severity),
      packageName: v.packageName,
      version: v.version,
      fixedIn: v.fixedIn,
      url: v.url,
    })),
  };
}

module.exports = { classifySeverity, summarize, buildReport };
