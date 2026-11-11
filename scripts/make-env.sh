#!/bin/sh
# Generates .env with fresh random secrets. Keeps an existing OPENROUTER_API_KEY.
set -e
cd "$(dirname "$0")/.."
KEY=""
[ -f .env ] && KEY=$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2-)
r() { openssl rand -hex 24; }
cat > .env <<ENV
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
PUBLIC_ORIGIN=http://localhost:3300
ALLOWED_EMAIL_DOMAIN=umkc.edu
DEV_SHOW_CODES=true
ENV
chmod 600 .env
echo ".env written"
