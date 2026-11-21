/*
 * Turns one HTML page into the form the server sends:
 *
 *   - every <script src> gets an `integrity` attribute (Subresource
 *     Integrity), computed from the file's bytes; or, for a sandboxed page
 *     (`inline: true`), the script text is written INTO the page;
 *   - the hashes of those scripts are collected for the Content-Security-Policy.
 *
 * It refuses, with a message naming the page and the cause, a page that
 * contains an inline <script>, an inline event-handler attribute or a
 * javascript: URL (they could not run under the CSP), or whose script is
 * missing, external or outside public/.
 *
 * Depends on node:fs/path/crypto only. It knows nothing about the policy
 * text (csp.js) or which pages exist (page-registry.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const TAG_RE = /<[a-z][^<>]*>/gi;
const EVENT_ATTR_RE = /\son[a-z]+\s*=/i;
const JS_URL_RE = /\s(?:href|src|action|formaction|data|poster|srcdoc)\s*=\s*["']?\s*javascript:/i;

function parseAttrs(text) {
  const attrs = [];
  for (const m of text.matchAll(ATTR_RE)) {
    attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? null });
  }
  return attrs;
}

function readScriptBytes(publicDir, htmlRel, src) {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    throw new Error(`${htmlRel}: external script "${src}" is not allowed (only same-origin files under public/)`);
  }
  const clean = src.split(/[?#]/)[0];
  const abs = clean.startsWith('/')
    ? path.join(publicDir, clean)
    : path.join(publicDir, path.dirname(htmlRel), clean);
  const resolved = path.resolve(abs);
  if (resolved !== publicDir && !resolved.startsWith(publicDir + path.sep)) {
    throw new Error(`${htmlRel}: script "${src}" resolves outside public/`);
  }
  try {
    return fs.readFileSync(resolved);
  } catch (err) {
    throw new Error(`${htmlRel}: cannot read script "${src}" (${err.code || err.message})`);
  }
}

function sha256Base64(data, encoding) {
  return 'sha256-' + crypto.createHash('sha256').update(data, encoding).digest('base64');
}

/**
 * Adds `integrity` to every <script src> of one page and collects the hashes.
 * Returns { html, hashes: string[] } (hashes are the bare `sha256-...` values).
 */
export function transformHtml(html, publicDir, htmlRel, { inline = false } = {}) {
  const hashes = [];

  // Checked on the page as written, before any script text is put into it.
  for (const tag of html.match(TAG_RE) || []) {
    if (EVENT_ATTR_RE.test(tag)) throw new Error(`${htmlRel}: inline event-handler attribute in ${tag.slice(0, 60)}`);
    if (JS_URL_RE.test(tag)) throw new Error(`${htmlRel}: javascript: URL in ${tag.slice(0, 60)}`);
  }

  const withIntegrity = html.replace(SCRIPT_RE, (_tag, attrText, body) => {
    const attrs = parseAttrs(attrText);
    const src = attrs.find((a) => a.name === 'src');
    if (!src || !src.value) {
      throw new Error(`${htmlRel}: inline <script> is not allowed (the CSP would block it)`);
    }
    if (body.trim() !== '') {
      throw new Error(`${htmlRel}: <script src="${src.value}"> must not have a body`);
    }
    if (attrs.some((a) => a.name === 'integrity')) {
      throw new Error(`${htmlRel}: <script src="${src.value}"> already has an integrity attribute (it is added by the server)`);
    }
    const bytes = readScriptBytes(publicDir, htmlRel, src.value);
    if (inline) {
      const text = bytes.toString('utf8');
      if (/<\/script|<script|<!--/i.test(text)) {
        throw new Error(`${htmlRel}: script "${src.value}" contains markup that cannot be written inline`);
      }
      const hash = sha256Base64(text, 'utf8');
      if (!hashes.includes(hash)) hashes.push(hash);
      return `<script>${text}</script>`;
    }
    const hash = sha256Base64(bytes);
    if (!hashes.includes(hash)) hashes.push(hash);
    return `<script${attrText.replace(/\s+$/, '')} integrity="${hash}"></script>`;
  });

  return { html: withIntegrity, hashes };
}

/**
 * The hashes a finished page needs in its policy: one per inline script and
 * one per integrity attribute, as written in `html`.
 */
export function scriptHashesIn(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) hashes.push(sha256Base64(m[1], 'utf8'));
  for (const m of html.matchAll(/<script\b[^>]*\bintegrity="([^"]+)"/gi)) hashes.push(m[1]);
  return hashes;
}
