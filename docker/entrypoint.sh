#!/bin/sh
set -eu

node server/database/runMigrations.js

if [ "${AUTO_PROVISION_ADMIN:-false}" = "true" ]; then
  if [ -z "${ADMIN_USERNAME:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ] || [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
    echo "AUTO_PROVISION_ADMIN=true requires ADMIN_USERNAME and ADMIN_PASSWORD (8+ characters)." >&2
    exit 1
  fi
  node scripts/setup-admin.js
else
  echo "Automatic administrator provisioning is disabled; open /setup in your browser for first-run setup."
fi

exec node server/index.js
