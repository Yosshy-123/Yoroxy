/*
 * Reads the browser scripts (public/assets/js) as text and works out which
 * file defines which member of the shared Yoroxy namespace (`Y.foo = ...`,
 * `Y.ui.bar = ...`) and which file uses it. No browser: static analysis only,
 * used by the structure specs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JS_DIR = 'public/assets/js';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out.sort();
}

export function scanBrowserScripts() {
  const files = walk(JS_DIR);
  const sources = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const defines = new Map(); // "ui.toast" / "config" -> file
  for (const [f, s] of sources) {
    // `Y.ui = Y.ui || {}` only initialises a namespace shared by several files; members are what count.
    for (const m of s.matchAll(/\bY\.(\w+)(?:\.(\w+))?\s*=(?!=)(?!\s*Y\.\w+\s*\|\|)/g)) defines.set(m[2] ? `${m[1]}.${m[2]}` : m[1], f);
    for (const m of s.matchAll(/^\s+Y\.(\w+) = \{([\s\S]*?)^\s+\};/gm)) defines.set(m[1], f);
  }

  /** The file that defines the namespace member a reference `Y.a` / `Y.a.b` names, or undefined. */
  function ownerOf(a, b) {
    const key = b && defines.has(`${a}.${b}`) ? `${a}.${b}` : a;
    return defines.get(key);
  }

  /** Every file whose members `file` refers to anywhere in its text. */
  function usesOf(file) {
    const used = new Set();
    for (const m of sources.get(file).matchAll(/\bY\.(\w+)(?:\.(\w+))?/g)) {
      const owner = ownerOf(m[1], m[2]);
      if (owner && owner !== file) used.add(owner);
    }
    return used;
  }

  /**
   * Files whose members `file` uses while it loads: the references on the
   * statements at the top level of its wrapper function (two-space indent),
   * not those inside function bodies, which run later.
   */
  function loadTimeUsesOf(file) {
    const used = new Set();
    for (const line of sources.get(file).split('\n')) {
      if (!/^ {2}\S/.test(line) || /^ {2}(?:\/\/|\/?\*)/.test(line)) continue;
      for (const m of line.matchAll(/\bY\.(\w+)(?:\.(\w+))?/g)) {
        const owner = ownerOf(m[1], m[2]);
        if (owner && owner !== file) used.add(owner);
      }
    }
    return used;
  }

  return { files, sources, defines, usesOf, loadTimeUsesOf };
}
