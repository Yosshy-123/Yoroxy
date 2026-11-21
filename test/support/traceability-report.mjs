#!/usr/bin/env node
/*
 * Cross-checks test/reports/coverage.ndjson (what passed, per `covers()`
 * calls) against test/traceability.json (what the test spec says must be
 * covered). Exits non-zero if any requirement has zero recorded coverage,
 * so "a requirement quietly stopped being tested" - or only has failing
 * tests - fails CI instead of going unnoticed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = path.join(root, 'traceability.json');
const coveragePath = process.env.YOROXY_COVERAGE_FILE || path.join(root, 'reports', 'coverage.ndjson');

const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const lines = fs.existsSync(coveragePath)
  ? fs.readFileSync(coveragePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

const executedTestIds = new Set(lines.map((l) => l.testId));

let missing = 0;
const rows = matrix.requirements.map((req) => {
  const allTestIds = req.tests;
  const executed = allTestIds.filter((id) => executedTestIds.has(id));
  const covered = executed.length > 0;
  if (!covered) missing++;
  return { id: req.id, description: req.description, allTestIds, executed, covered };
});

for (const row of rows) {
  const mark = row.covered ? 'OK  ' : 'MISS';
  console.log(`[${mark}] ${row.id.padEnd(24)} ${row.description}`);
  if (!row.covered) {
    console.log(`       expected one of: ${row.allTestIds.join(', ')}`);
  }
}

console.log('');
console.log(`${rows.length - missing}/${rows.length} tracked requirements (the subset listed in test/traceability.json, not every requirement in the spec) have at least one passing test.`);

fs.writeFileSync(
  path.join(root, 'reports', 'traceability-report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)
);

if (missing > 0) {
  console.error(`\n${missing} requirement(s) have NO passing test. See reports/traceability-report.json.`);
  process.exit(1);
}
