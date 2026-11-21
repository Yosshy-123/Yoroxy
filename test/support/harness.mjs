/*
 * Starts the Yoroxy app server and the target-site fixture server as child
 * processes, waits until both accept connections, runs the supplied async
 * callback, and always tears both processes down afterwards (including on
 * uncaught errors) — so a test run never leaves stray listeners behind.
 *
 * This intentionally uses child_process rather than importing the servers
 * in-process: both entry points install SIGINT/SIGTERM handlers and
 * otherwise assume they own the process lifecycle, so running them as real
 * child processes is the least surprising choice and matches how they run in
 * production/CI. The app is started by start-app.mjs (test configuration),
 * not by index.js (production configuration).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const appEntry = path.resolve(here, 'start-app.mjs');
const fixtureEntry = path.resolve(here, '../fixtures/target-site/server.mjs');

export const APP_PORT = Number(process.env.YOROXY_TEST_APP_PORT || 8080);
export const FIXTURE_PORT = Number(process.env.YOROXY_TEST_FIXTURE_PORT || 9100);
export const APP_BASE = `http://localhost:${APP_PORT}`;
export const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_PORT}`;

function waitForHttp(url, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url);
        // Any HTTP response (even 404) proves the server is accepting
        // connections and routing requests.
        if (res.status) {
          resolve();
          return;
        }
      } catch (err) {
        // connection refused / not up yet
      }
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}

function spawnServer(command, args, opts) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  const output = [];
  child.stdout.on('data', (d) => output.push(d.toString()));
  child.stderr.on('data', (d) => output.push(d.toString()));
  child.getOutput = () => output.join('');
  return child;
}

function killAndWait(child) {
  if (!child || child.killed || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 3000).unref();
  });
}

/**
 * Imperative form: starts both servers and resolves once they're ready,
 * returning { appBase, fixtureBase, stop }. Callers control
 * start/stop separately (e.g. one pair of servers shared across many spec
 * files by a single orchestrator).
 */
export async function startServers() {
  const app = spawnServer(process.execPath, [appEntry], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(APP_PORT) },
  });
  const fixture = spawnServer(process.execPath, [fixtureEntry], {
    env: { ...process.env, PORT: String(FIXTURE_PORT) },
  });

  const stop = async () => {
    await Promise.all([killAndWait(app), killAndWait(fixture)]);
  };

  const onSignal = () => {
    stop().finally(() => process.exit(1));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await Promise.all([
      waitForHttp(`${APP_BASE}/container.html`),
      waitForHttp(`${FIXTURE_BASE}/`),
    ]);
  } catch (err) {
    await stop();
    throw new Error(
      `${err.message}\n--- app output ---\n${app.getOutput()}\n--- fixture output ---\n${fixture.getOutput()}`
    );
  }

  return {
    appBase: APP_BASE,
    fixtureBase: FIXTURE_BASE,
    stop: async () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      await stop();
    },
  };
}
