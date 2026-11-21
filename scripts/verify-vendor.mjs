/*
 * Checks that the vendored Ultraviolet files in public/uv/ are exactly the
 * ones recorded in vendor/uv/checksums.json, and that the local patch of
 * uv.handler.js is the recorded one.
 *
 *   node scripts/verify-vendor.mjs            verify (exit 1 on any difference)
 *   node scripts/verify-vendor.mjs --update   record the current files as the
 *                                             new baseline (after a deliberate
 *                                             UV update or patch change)
 *
 * The patch is the text between the "YOROXY PATCH BEGIN" and "YOROXY PATCH
 * END" marker lines of uv.handler.js plus one call appended to its last line.
 * Removing both gives the "unpatched candidate": what the file looked like
 * before the patch, as far as it can be reconstructed. vendor/uv/patches/
 * yoroxy-handler.patch is the diff from that candidate to the served file.
 *
 * Depends on node:fs, node:path, node:crypto and the `diff` command (only for
 * --update, which writes the patch file).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UV_DIR = path.join(ROOT, 'public', 'uv');
const RECORD = path.join(ROOT, 'vendor', 'uv', 'checksums.json');
const PATCH_FILE = path.join(ROOT, 'vendor', 'uv', 'patches', 'yoroxy-handler.patch');
const SERVED = ['sw.js', 'uv.bundle.js', 'uv.client.js', 'uv.config.js', 'uv.handler.js', 'uv.sw.js'];
const BEGIN = 'YOROXY PATCH BEGIN';
const END = 'YOROXY PATCH END';
const TAIL_CALL = 'yoroxyHarden(o);yoroxyPatch(o,e,a);';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Splits uv.handler.js into the patch block, the call, and the unpatched candidate. */
function dissect(text) {
  const lines = text.split('\n');
  const begin = lines.findIndex((l) => l.includes(BEGIN));
  const end = lines.findIndex((l) => l.includes(END));
  if (begin === -1 || end === -1 || end < begin) throw new Error(`uv.handler.js: the ${BEGIN} / ${END} markers are missing or out of order`);
  const block = lines.slice(begin, end + 1).join('\n');
  const rest = [...lines.slice(0, begin), ...lines.slice(end + 1)].join('\n');
  if (rest.split(TAIL_CALL).length !== 2) throw new Error(`uv.handler.js: "${TAIL_CALL}" must appear exactly once`);
  return { block, candidate: rest.replace(TAIL_CALL, ''), beginLine: begin + 1, endLine: end + 1 };
}

function measure() {
  const served = {};
  for (const name of SERVED) served[name] = sha256(fs.readFileSync(path.join(UV_DIR, name)));
  const handler = dissect(fs.readFileSync(path.join(UV_DIR, 'uv.handler.js'), 'utf8'));
  return { served, handler };
}

function writePatch(handlerText, candidate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoroxy-vendor-'));
  const a = path.join(dir, 'uv.handler.unpatched.js');
  const b = path.join(dir, 'uv.handler.js');
  fs.writeFileSync(a, candidate);
  fs.writeFileSync(b, handlerText);
  let out;
  try {
    out = execFileSync('diff', ['-u', '--label', 'a/uv.handler.js', '--label', 'b/uv.handler.js', a, b], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err.status !== 1) throw err; // diff exits 1 when the files differ
    out = err.stdout;
  }
  fs.mkdirSync(path.dirname(PATCH_FILE), { recursive: true });
  fs.writeFileSync(PATCH_FILE, out);
  fs.rmSync(dir, { recursive: true, force: true });
}

function update() {
  const handlerText = fs.readFileSync(path.join(UV_DIR, 'uv.handler.js'), 'utf8');
  const { served, handler } = measure();
  writePatch(handlerText, handler.candidate);
  const record = {
    note: 'Baseline of the vendored Ultraviolet files. The upstream version is not recorded (see vendor/uv/UPSTREAM.md). Regenerate with: node scripts/verify-vendor.mjs --update',
    served,
    patch: {
      file: 'patches/yoroxy-handler.patch',
      fileSha256: sha256(fs.readFileSync(PATCH_FILE)),
      blockLines: [handler.beginLine, handler.endLine],
      blockSha256: sha256(handler.block),
      tailCall: TAIL_CALL,
      unpatchedCandidateSha256: sha256(handler.candidate),
    },
  };
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
  console.log('vendor/uv/checksums.json updated');
}

function verify() {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  const { served, handler } = measure();
  const problems = [];
  for (const name of SERVED) {
    if (served[name] !== record.served[name]) problems.push(`public/uv/${name} differs from the recorded checksum`);
  }
  if (sha256(handler.block) !== record.patch.blockSha256) problems.push('the YOROXY PATCH block of uv.handler.js differs from the recorded one');
  if (sha256(handler.candidate) !== record.patch.unpatchedCandidateSha256) problems.push('uv.handler.js without its patch differs from the recorded unpatched candidate');
  if (record.patch.tailCall !== TAIL_CALL) problems.push('the recorded tail call is not the one this script knows');
  const patchFile = path.join(ROOT, 'vendor', 'uv', record.patch.file);
  if (!fs.existsSync(patchFile) || sha256(fs.readFileSync(patchFile)) !== record.patch.fileSha256) problems.push(`${record.patch.file} is missing or differs from the recorded checksum`);
  if (problems.length) {
    for (const p of problems) console.error('FAIL: ' + p);
    process.exit(1);
  }
  console.log(`vendored UV matches vendor/uv/checksums.json (${SERVED.length} files, patch ${handler.beginLine}-${handler.endLine})`);
}

if (process.argv.includes('--update')) update();
else verify();
