#!/usr/bin/env bash
# Run ON THE MAC, once, after server-setup.sh:
#   bash deploy/send-env.sh <user@ip> <expected-hostname> <domain>
# Writes ~/rooroom/shared/.env on the server with fresh random secrets and the OpenRouter key
# taken from this Mac's rooroom/.env. Secrets go over SSH only; they are never in git or GitHub.
# Refuses to overwrite an existing server .env: a new CONTENT_KEY would make every encrypted chat
# message and anonymous note unreadable.
set -euo pipefail
HOST="${1:?usage: send-env.sh <user@ip> <expected-hostname> <domain>}"
EXPECTED="${2:?expected hostname}"; DOMAIN="${3:?domain}"
cd "$(dirname "$0")/.."
KEY=$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2-)
[ -n "$KEY" ] || { echo "No OPENROUTER_API_KEY in local .env" >&2; exit 1; }
r() { openssl rand -hex 24; }

ssh ${SSH_OPTS:-} "$HOST" "bash -s -- '$EXPECTED'" <<REMOTE
set -euo pipefail
[ "\$(hostname)" = "\$1" ] || { echo "REFUSING: this is '\$(hostname)', not \$1." >&2; exit 1; }
F="\$HOME/rooroom/shared/.env"
[ -f "\$F" ] && { echo "REFUSING: \$F already exists." >&2; exit 1; }
mkdir -p "\$(dirname "\$F")"; umask 077
cat > "\$F" <<'ENV'
OPENROUTER_API_KEY=${KEY}
OWNER_DB_PASSWORD=$(r)
APP_DB_PASSWORD=$(r)
WORKER_DB_PASSWORD=$(r)
MODERATOR_DB_PASSWORD=$(r)
MINIO_ROOT_USER=rooroom
MINIO_ROOT_PASSWORD=$(r)
CONTENT_KEY=$(openssl rand -base64 32)
CHAT_TICKET_SECRET=$(r)
WORKER_TOKEN=$(r)
PUBLIC_ORIGIN=https://${DOMAIN}
ALLOWED_EMAIL_DOMAIN=umkc.edu
DEV_SHOW_CODES=true
OTP_SKIP_EMAILS=okafor@umkc.edu,lindqvist@umkc.edu,bauer@umkc.edu,amara@umkc.edu,diego@umkc.edu,fatima@umkc.edu,hana@umkc.edu,jonah@umkc.edu,kenji@umkc.edu,lena@umkc.edu,lucas@umkc.edu,omar@umkc.edu,priya@umkc.edu,sofia@umkc.edu,wei@umkc.edu,rafida.zaman@umkc.edu
ENV
echo "✅ \$F written (sign-in codes are off until deploy/send-mail-env.sh is run)"
REMOTE
