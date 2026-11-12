#!/usr/bin/env bash
# Run ON THE MAC to switch on sign-in codes by email (or to change the Gmail account):
#   bash deploy/send-mail-env.sh <user@ip> <expected-hostname>
# Reads GMAIL_USER and GMAIL_APP_PASSWORD from ~/rooroom-gmail.txt and OTP_SKIP_EMAILS from
# .env.example, and sets those three lines in the server's ~/rooroom/shared/.env (other lines are
# kept). The app password goes over SSH only; it is never in git or GitHub.
# Takes effect on the next deploy, or right away with: docker compose up -d web (in ~/rooroom/current).
set -euo pipefail
HOST="${1:?usage: send-mail-env.sh <user@ip> <expected-hostname>}"
EXPECTED="${2:?expected hostname}"
cd "$(dirname "$0")/.."
SRC="${GMAIL_FILE:-$HOME/rooroom-gmail.txt}"
GU=$(grep '^GMAIL_USER=' "$SRC" | cut -d= -f2-)
GP=$(grep '^GMAIL_APP_PASSWORD=' "$SRC" | cut -d= -f2- | tr -d ' ')
SKIP=$(grep '^OTP_SKIP_EMAILS=' .env.example | cut -d= -f2-)
[ -n "$GU" ] && [ -n "$GP" ] || { echo "No GMAIL_USER / GMAIL_APP_PASSWORD in $SRC" >&2; exit 1; }

ssh ${SSH_OPTS:-} "$HOST" "bash -s -- '$EXPECTED'" <<REMOTE
set -euo pipefail
[ "\$(hostname)" = "\$1" ] || { echo "REFUSING: this is '\$(hostname)', not \$1." >&2; exit 1; }
F="\$HOME/rooroom/shared/.env"
[ -f "\$F" ] || { echo "REFUSING: \$F does not exist (run send-env.sh first)." >&2; exit 1; }
umask 077
grep -v -E '^(GMAIL_USER|GMAIL_APP_PASSWORD|OTP_SKIP_EMAILS)=' "\$F" > "\$F.new" || true
cat >> "\$F.new" <<'ENV'
GMAIL_USER=${GU}
GMAIL_APP_PASSWORD=${GP}
OTP_SKIP_EMAILS=${SKIP}
ENV
mv "\$F.new" "\$F"
echo "✅ Gmail settings written to \$F"
REMOTE
