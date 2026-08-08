const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

class AccountValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountValidationError';
    this.code = code;
  }
}

function normalizeOptionalEmail(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new AccountValidationError('INVALID_EMAIL', 'Email must be a string');
  }

  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 100 || !EMAIL_PATTERN.test(email)) {
    throw new AccountValidationError('INVALID_EMAIL', 'Email must be a valid address no longer than 100 characters');
  }
  return email;
}

function validateAccountPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new AccountValidationError('INVALID_PASSWORD', 'Password must be 8 to 128 characters');
  }
  return value;
}

module.exports = {
  AccountValidationError,
  normalizeOptionalEmail,
  validateAccountPassword,
};
