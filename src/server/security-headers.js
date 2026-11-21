/*
 * Headers added to every response (SEC-06). Express pages and Bare responses
 * both get them; the Content-Security-Policy is page-specific and is added
 * by the route that serves a shell page (see static-routes.js).
 */
export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function securityHeaders(_req, res, next) {
  applySecurityHeaders(res);
  next();
}
