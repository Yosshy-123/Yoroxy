/*
 * The Express app: the shell and internal pages (with their CSP) and the
 * static assets.
 *
 *   - HTML pages are served from memory (pages/page-registry.js builds them)
 *     so that no page can be delivered without its Content-Security-Policy;
 *   - static files are served from exactly two directories, /assets and /uv.
 *     Nothing else under public/ is reachable, whatever its extension: an
 *     allow-list of directories rather than a deny-list of file types.
 *
 * Express serves nothing of its own accord beyond this: Bare (/bare/) is
 * routed before Express in create-server.js, and there is no CORS middleware
 * on purpose - every page that loads these assets is on this same origin.
 */
import path from 'node:path';
import express from 'express';
import { notFound, expressErrorHandler } from './error-handlers.js';
import { securityHeaders } from './security-headers.js';

const STATIC_OPTIONS = Object.freeze({ index: false, redirect: false, dotfiles: 'ignore' });

/**
 * @param {{ publicDir: string, pages: { pages: Map, routes: Map } }} deps
 *   `pages` is the result of buildShellPages().
 */
export function createApp({ publicDir, pages }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  for (const [urlPath, rel] of pages.routes) {
    const page = pages.pages.get(rel);
    app.get(urlPath, (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Security-Policy', page.csp);
      res.send(page.html);
    });
  }

  app.use('/assets', express.static(path.join(publicDir, 'assets'), STATIC_OPTIONS));
  app.use('/uv', express.static(path.join(publicDir, 'uv'), STATIC_OPTIONS));

  app.use(notFound);
  app.use(expressErrorHandler);
  return app;
}
