/*
 * Lets a spec declare "this `it` covers these requirement/test IDs", and
 * appends that fact to test/reports/coverage.ndjson (append-only, so it's
 * safe even if multiple spec files or workers write concurrently).
 *
 * A declaration only counts when the test then PASSES: covers() queues the
 * entry, and an afterEach hook registered here writes the queue out iff the
 * test that just ran passed. A failing test therefore leaves its requirement
 * uncovered (reported as MISS by traceability-report.mjs) instead of being
 * counted as exercised.
 *
 * traceability-report.mjs later cross-checks the file against
 * test/traceability.json to make sure every requirement in the matrix was
 * covered by at least one passing test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

export const coverageFile =
  process.env.YOROXY_COVERAGE_FILE ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../reports/coverage.ndjson');

fs.mkdirSync(path.dirname(coverageFile), { recursive: true });

let pending = [];

afterEach((t) => {
  const entries = pending;
  pending = [];
  if (!t.passed) return;
  for (const entry of entries) fs.appendFileSync(coverageFile, JSON.stringify(entry) + '\n');
});

/**
 * covers('T-40', ['FR-TAB-12']) - call once per `it`, near the top of its
 * body. Recorded only if the test passes.
 */
export function covers(testId, frIds = []) {
  pending.push({ testId, frIds, ts: Date.now() });
}

export function resetCoverageLog() {
  fs.writeFileSync(coverageFile, '');
}
