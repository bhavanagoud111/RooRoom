#!/usr/bin/env bash
# Runs ON the server, fed over SSH by .github/workflows/deploy.yml (or deploy/deploy-from-mac.sh):
#   ssh host "bash -s -- <sha> <expected-hostname>" < deploy/remote-deploy.sh
# The code arrives beforehand as ~/rooroom/incoming/<sha>.tar.gz; the server never talks to GitHub.
#
# Fail-closed: the new images are built while the old stack keeps running. Only when the build
# succeeds is the stack switched over. If the site does not answer afterwards, it switches back.
# Database and file storage live in Docker volumes (project name "rooroom"), so they survive deploys.
set -euo pipefail
SHA="${1:?sha}"; EXPECTED="${2:?expected hostname}"
[ "$(hostname)" = "$EXPECTED" ] || { echo "REFUSING: this is '$(hostname)', not $EXPECTED." >&2; exit 1; }

BASE="$HOME/rooroom"
TARBALL="$BASE/incoming/$SHA.tar.gz"
NEW="$BASE/releases/$SHA"
ENV_FILE="$BASE/shared/.env"
[ -f "$TARBALL" ] || { echo "Missing $TARBALL" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (run deploy/send-env.sh from the Mac first)" >&2; exit 1; }

rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf "$TARBALL" -C "$NEW"
ln -sf "$ENV_FILE" "$NEW/.env"
PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"

echo "▸ Building $SHA (old stack keeps running)"
(cd "$NEW" && docker compose build --pull)

echo "▸ Switching over"
(cd "$NEW" && docker compose up -d --remove-orphans)
ln -sfn "$NEW" "$BASE/current"

healthy() {
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3300/ || true)
    case "$code" in 2??|3??) return 0 ;; esac
    sleep 3
  done
  return 1
}

if ! healthy; then
  echo "✗ Site did not answer after the switch." >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$NEW" ]; then
    echo "▸ Rolling back to $(basename "$PREV")" >&2
    (cd "$PREV" && docker compose up -d --remove-orphans)
    ln -sfn "$PREV" "$BASE/current"
  fi
  exit 1
fi

# First deploy only: load the real UMKC catalogue and the stage demo.
if [ ! -f "$BASE/shared/.seeded" ]; then
  echo "▸ First deploy: importing UMKC courses and seeding the demo"
  (cd "$NEW" && python3 scripts/import_umkc.py --term 5443 --label "Fall 2026")
  # Storage's S3 port comes up a little after the web app on a small box; wait for it.
  for _ in $(seq 1 40); do
    docker exec rooroom-web-1 node -e "require('net').connect(8333,'storage').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
    sleep 3
  done
  # The seed script also runs `docker exec` against the database, so give it the Docker CLI.
  docker run --rm --network host -v /var/run/docker.sock:/var/run/docker.sock -v "$NEW:/app:ro" -w /app \
    -e ROOROOM_URL=http://127.0.0.1:3300 node:22-alpine \
    sh -c "apk add -q --no-cache docker-cli && node scripts/seed-demo.mjs" && touch "$BASE/shared/.seeded"
fi

# Keep the last 3 releases and tarballs.
ls -1dt "$BASE"/releases/* 2>/dev/null | tail -n +4 | xargs -r rm -rf
ls -1t "$BASE"/incoming/*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
docker image prune -f >/dev/null
echo "✅ Deployed $SHA"
