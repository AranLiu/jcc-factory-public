function normalizeAllowedOrigins(allowedOrigins) {
  const normalized = [];
  const seen = new Set();

  for (const candidate of Array.isArray(allowedOrigins) ? allowedOrigins : []) {
    const value = String(candidate).trim();
    if (!value) continue;

    try {
      const url = new URL(value);
      const isHttpOrigin = url.protocol === 'http:' || url.protocol === 'https:';
      const isOriginOnly = !url.username && !url.password
        && url.pathname === '/'
        && !url.search
        && !url.hash;
      if (!isHttpOrigin || !isOriginOnly || seen.has(url.origin)) continue;

      seen.add(url.origin);
      normalized.push(url.origin);
    } catch {
      // Invalid configured origins are ignored rather than copied into CSP.
    }
  }

  return normalized;
}

function buildCspDirectives({ allowedOrigins } = {}) {
  const connectSrc = ["'self'"];
  const seenConnections = new Set(connectSrc);

  for (const origin of normalizeAllowedOrigins(allowedOrigins)) {
    const url = new URL(origin);
    const websocketOrigin = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
    for (const source of [origin, websocketOrigin]) {
      if (!seenConnections.has(source)) {
        seenConnections.add(source);
        connectSrc.push(source);
      }
    }
  }

  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    mediaSrc: ["'self'", 'blob:', 'data:'],
    connectSrc,
    imgSrc: ["'self'", 'data:', 'blob:'],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
  };
}

module.exports = { buildCspDirectives };
