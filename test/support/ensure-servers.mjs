/*
 * Lets every spec file be run either:
 *   (a) standalone — `node --test test/specs/foo.spec.mjs` — in which case
 *       this module starts its own app+fixture servers on first use and
 *       registers a node:test `after()` hook to stop them; or
 *   (b) orchestrated — via test/run-all.mjs, which starts one pair of
 *       servers up front and exports their base URLs through environment
 *       variables so every spec file just reuses them.
 *
 * Either way, spec files only ever call `await ensureServers()` and get
 * back { appBase, fixtureBase } without needing to know which mode is
 * active.
 */
import { after } from 'node:test';
import { startServers } from './harness.mjs';

let cached = null;

export async function ensureServers() {
  if (cached) return cached;

  if (process.env.YOROXY_SERVERS_ALREADY_RUNNING === '1') {
    cached = {
      appBase: process.env.YOROXY_APP_BASE,
      fixtureBase: process.env.YOROXY_FIXTURE_BASE,
    };
    return cached;
  }

  const { appBase, fixtureBase, stop } = await startServers();
  cached = { appBase, fixtureBase };
  after(async () => {
    await stop();
  });
  return cached;
}
