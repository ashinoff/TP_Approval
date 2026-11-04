#!/bin/sh
set -eu

# Amvera mounts a fresh persistent volume after the image has been built.
# Prepare the directory as root, then run setup and the API as the unprivileged user.
if [ "$(id -u)" = 0 ]; then
  install -d -m 700 -o node -g node "${STORAGE_PATH:-/data/storage}"
  # Embedded ClamAV listens on 127.0.0.1 only; signatures persist on the volume.
  if [ "${CLAMAV_HOST:-}" = 127.0.0.1 ]; then
    install -d -m 755 -o clamav -g clamav /data/clamav /run/clamav
    [ -f /data/clamav/main.cvd ] || [ -f /data/clamav/main.cld ] || freshclam --stdout || echo 'freshclam: первая загрузка сигнатур не удалась, повтор в фоне.' >&2
    freshclam -d --stdout || true
    clamd || echo "clamd не запущен: загрузка документов будет отвечать SCANNER_UNAVAILABLE." >&2
  fi
  exec gosu node "$0" "$@"
fi

if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  node dist/setup/scripts/setup-standalone.js
elif [ -n "${INITIAL_ADMIN_PASSWORD:-}" ]; then
  echo 'Для первого запуска с INITIAL_ADMIN_PASSWORD укажите MIGRATION_DATABASE_URL.' >&2
  exit 1
fi

# The HTTP process does not inherit migration credentials or the bootstrap password.
unset MIGRATION_DATABASE_URL INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_LOGIN INITIAL_ADMIN_NAME ADMIN_RESET_PASSWORD
exec "$@"
