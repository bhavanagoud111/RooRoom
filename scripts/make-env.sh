#!/bin/sh
# Generates .env with fresh random secrets. Keeps an existing OPENROUTER_API_KEY and Gmail settings.
set -e
cd "$(dirname "$0")/.."
KEY=""
[ -f .env ] && KEY=$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2-)
GU=""; GP=""
[ -f .env ] && GU=$(grep '^GMAIL_USER=' .env | cut -d= -f2-) && GP=$(grep '^GMAIL_APP_PASSWORD=' .env | cut -d= -f2-)
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
GMAIL_USER=${GU}
GMAIL_APP_PASSWORD=${GP}
OTP_SKIP_EMAILS=okafor@umkc.edu,lindqvist@umkc.edu,bauer@umkc.edu,amara@umkc.edu,diego@umkc.edu,fatima@umkc.edu,hana@umkc.edu,jonah@umkc.edu,kenji@umkc.edu,lena@umkc.edu,lucas@umkc.edu,omar@umkc.edu,priya@umkc.edu,sofia@umkc.edu,wei@umkc.edu,rafida.zaman@umkc.edu
ENV
chmod 600 .env
echo ".env written"
