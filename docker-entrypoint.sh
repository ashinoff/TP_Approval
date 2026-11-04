#!/bin/sh
set -eu

# Amvera mounts a fresh persistent volume after the image has been built.
# Prepare the directory as root, then run setup and the API as the unprivileged user.
if [ "$(id -u)" = 0 ]; then
  install -d -m 700 -o node -g node "${STORAGE_PATH:-/data/storage}"
  exec gosu node "$0" "$@"
fi

if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  node dist/setup/scripts/setup-standalone.js
elif [ -n "${INITIAL_ADMIN_PASSWORD:-}" ]; then
  echo 'Для первого запуска с INITIAL_ADMIN_PASSWORD укажите MIGRATION_DATABASE_URL.' >&2
  exit 1
fi

# The HTTP process does not inherit migration credentials or the bootstrap password.
unset MIGRATION_DATABASE_URL INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_LOGIN INITIAL_ADMIN_NAME
exec "$@"
