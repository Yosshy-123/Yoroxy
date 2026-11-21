#!/usr/bin/env node
/*
 * Orchestrates the whole suite:
 *   1. Starts the app server + fixture server exactly once.
 *   2. Runs every *.spec.mjs under specs/, visual/, a11y/ in-process via
 *      node:test's programmatic API, sharing those two servers.
 *   3. Prints human-readable ('spec') output, and writes a JUnit XML
 *      report to reports/junit.xml for CI.
 *   4. Runs the traceability cross-check and prints/writes its report.
 *   5. Stops both servers, and exits non-zero if any test failed OR any
 *      requirement in traceability.json ended up with zero coverage.
 *
 * Usage: node test/run-all.mjs [glob-ish substring to filter file names]
 */
import { run } from 'node:test';
import { spec as SpecReporter } from 'node:test/reporters';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServers } from './support/harness.mjs';
import { resetCoverageLog } from './support/traceability.mjs';

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function toJUnitXml(summary) {
  const total = summary.pass + summary.fail;
  const cases = summary.cases
    .map((c) => {
      const time = (c.durationMs / 1000).toFixed(3);
      if (c.ok) {
        return `    <testcase name="${xmlEscape(c.name)}" classname="${xmlEscape(c.file || '')}" time="${time}"/>`;
      }
      return `    <testcase name="${xmlEscape(c.name)}" classname="${xmlEscape(c.file || '')}" time="${time}">\n      <failure message="${xmlEscape(c.error)}"/>\n    </testcase>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="yoroxy-e2e" tests="${total}" failures="${summary.fail}">\n${cases}\n</testsuite>\n`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.spec.mjs')) out.push(full);
  }
  return out;
}

const files = [...walk(path.join(here, 'specs')), ...walk(path.join(here, 'visual')), ...walk(path.join(here, 'a11y'))]
  .filter((f) => f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`No spec files matched filter "${filter}".`);
  process.exit(1);
}

console.log(`Running ${files.length} spec file(s):`);
for (const f of files) console.log(`  - ${path.relative(here, f)}`);
console.log('');

fs.mkdirSync(path.join(here, 'reports'), { recursive: true });
resetCoverageLog();

const { appBase, fixtureBase, stop } = await startServers();
process.env.YOROXY_SERVERS_ALREADY_RUNNING = '1';
process.env.YOROXY_APP_BASE = appBase;
process.env.YOROXY_FIXTURE_BASE = fixtureBase;

let testsFailed = false;

try {
  const stream = run({ files, concurrency: 1, timeout: 120_000 });

  // Our own tally, independent of whichever reporter consumes the stream,
  // so we always know the pass/fail exit status even if a reporter's own
  // API shape changes between Node versions, and so we can emit a plain
  // JUnit XML file for CI without depending on node:test's own JUnit
  // reporter transform (which would require consuming the stream twice).
  const summary = { pass: 0, fail: 0, failures: [], cases: [] };
  stream.on('test:pass', (evt) => {
    if (evt.details?.type !== 'test') return; // ignore describe()/suite-level pass events
    summary.pass++;
    summary.cases.push({ name: evt.name, file: evt.file, ok: true, durationMs: evt.details?.duration_ms ?? 0 });
  });
  stream.on('test:fail', (evt) => {
    if (evt.details?.type !== 'test') return; // ignore describe()/suite-level fail events
    summary.fail++;
    const error = evt.details?.error?.message || String(evt.details?.error || 'unknown error');
    summary.failures.push({ name: evt.name, file: evt.file, error });
    summary.cases.push({ name: evt.name, file: evt.file, ok: false, error, durationMs: evt.details?.duration_ms ?? 0 });
  });

  for await (const chunk of stream.compose(new SpecReporter())) {
    process.stdout.write(chunk);
  }

  fs.writeFileSync(path.join(here, 'reports', 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(here, 'reports', 'junit.xml'), toJUnitXml(summary));
  testsFailed = summary.fail > 0;

  console.log('');
  console.log(`${summary.pass} passed, ${summary.fail} failed.`);
  if (summary.fail > 0) {
    console.log('Failed tests:');
    for (const f of summary.failures) console.log(`  - [${f.file}] ${f.name}: ${f.error}`);
  }
} finally {
  await stop();
}

// --- traceability cross-check -------------------------------------------
let traceabilityFailed = false;
try {
  execFileSync(process.execPath, [path.join(here, 'support', 'traceability-report.mjs')], { stdio: 'inherit' });
} catch (err) {
  traceabilityFailed = true;
}

process.exit(testsFailed || traceabilityFailed ? 1 : 0);
