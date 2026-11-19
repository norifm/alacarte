#!/bin/sh
# Runs the web app as PUID/PGID when they are set, so downloads are owned by
# that user instead of root. Without them (or when the container already
# starts as a non-root user) it runs the command unchanged.
set -eu

PUID=${PUID:-}
PGID=${PGID:-}
UMASK=${UMASK:-}

if [ -n "$UMASK" ]; then
  case "$UMASK" in
    *[!0-7]*) echo "[entrypoint] UMASK must be octal, e.g. 022 or 002 (got '$UMASK')" >&2; exit 1 ;;
  esac
  umask "$UMASK"
fi

if [ -z "$PUID" ] || [ "$(id -u)" != "0" ]; then
  if [ -z "$PUID" ] && [ -n "$PGID" ]; then
    echo "[entrypoint] PGID is set without PUID, ignoring it and running as root" >&2
  fi
  exec "$@"
fi

PGID=${PGID:-$PUID}
for id in "$PUID" "$PGID"; do
  case "$id" in
    ''|*[!0-9]*) echo "[entrypoint] PUID and PGID must be numeric ids (got '$PUID:$PGID')" >&2; exit 1 ;;
  esac
done

CONFIG_DIR=${AMDL_CONFIG_DIR:-/config}
MUSIC_DIR=${AMDL_MUSIC_PATH:-/music}
STAGING_DIR=/tmp/alacarte-staging

# Settings, the database and the secret key were written as root by earlier
# versions. Only touch what is not already owned, so restarts stay quick.
for dir in "$CONFIG_DIR" "$STAGING_DIR"; do
  [ -d "$dir" ] || continue
  find "$dir" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} +
done
# The library itself is never chowned recursively: point it at a folder that
# user can write to. Albums downloaded as root before need a one-time chown.
if [ -d "$MUSIC_DIR" ] && ! setpriv --reuid="$PUID" --regid="$PGID" --clear-groups test -w "$MUSIC_DIR"; then
  echo "[entrypoint] $MUSIC_DIR is not writable by $PUID:$PGID, downloads will fail until it is (chown it on the host)" >&2
fi

export HOME=/tmp
echo "[entrypoint] running as $PUID:$PGID"
exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
