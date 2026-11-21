# Vendored Ultraviolet

`public/uv/` holds the Ultraviolet (UV) web proxy files the shell serves:

| File | What it is |
|---|---|
| `uv.bundle.js`, `uv.client.js`, `uv.sw.js` | UV as received |
| `uv.handler.js` | UV's handler **with a local patch** (below) |
| `uv.config.js`, `sw.js` | this app's UV configuration and service worker entry |

## Origin

The upstream project, version and commit these files were taken from **were not
recorded** when they were added, and cannot be told from the files. When the
version is known, write it here. Until then the baseline is the content of the
files as they are.

## The local patch

`uv.handler.js` contains the text between the lines `YOROXY PATCH BEGIN` and
`YOROXY PATCH END`, and one call, `yoroxyHarden(o);yoroxyPatch(o,e,a);`, at the
end of its last line. It sends "open a new tab / window" requests of proxied
pages to the browser shell (`window.top.__yoroxyShell`) and blocks the
techniques a proxied page could use to reach the shell's document. The code
carries its own explanation.

`patches/yoroxy-handler.patch` is the unified diff from the file without the
patch (reconstructed by removing the block and the call) to the served file.

## Checking and updating

- `npm run verify:vendor` compares `public/uv/*` with `checksums.json`, the
  patch block with its recorded hash, and the patch file with its hash.
- After updating UV or changing the patch on purpose, record the new baseline
  with `node scripts/verify-vendor.mjs --update` and commit `checksums.json`
  and `patches/yoroxy-handler.patch`. When updating UV, apply the patch to the
  new `uv.handler.js` by hand: insert the block after its first statement and
  append the call, then run the end-to-end suite
  (`test/specs/security/reach-paths.spec.mjs` among others).
