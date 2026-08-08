const PUBLIC_API_REQUESTS = new Set([
  'GET /health',
  'POST /auth/login',
  'GET /auth/setup-status',
  'POST /auth/setup',
]);

function requestPath(req) {
  const rawPath = req?.path || req?.url || req?.originalUrl || '';
  const path = String(rawPath).split('?', 1)[0];
  return path.startsWith('/api/') ? path.slice(4) : path;
}

function isPublicApiRequest(req) {
  const method = String(req?.method || '').toUpperCase();
  return PUBLIC_API_REQUESTS.has(`${method} ${requestPath(req)}`);
}

module.exports = { isPublicApiRequest };
