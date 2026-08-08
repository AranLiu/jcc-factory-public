const { isCsrfRequestAllowed } = require('../utils/sessionSecurity');

function createCsrfProtection(allowedOrigins) {
  return (req, res, next) => {
    if (!isCsrfRequestAllowed(req, allowedOrigins)) {
      return res.status(403).json({ message: 'CSRF validation failed' });
    }
    return next();
  };
}

function createOriginProtection(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.headers?.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      return res.status(403).json({ message: 'Origin validation failed' });
    }
    return next();
  };
}

module.exports = { createCsrfProtection, createOriginProtection };
