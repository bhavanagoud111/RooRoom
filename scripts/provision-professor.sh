#!/bin/sh
# Creates a professor account for an instructor on the UMKC schedule and links it to every room
# they teach. This is the university's job in real life (sign-up only ever creates students).
#
#   ./scripts/provision-professor.sh "Rafida Zaman" zamanr@umkc.edu
# Prints a one-time password. The email must be the professor's real university address.
set -e
NAME="$1"; EMAIL="$2"
[ -n "$NAME" ] && [ -n "$EMAIL" ] || { echo "usage: $0 \"Instructor Name\" email@umkc.edu"; exit 1; }
PW=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
docker exec -i rooroom-db-1 psql -v ON_ERROR_STOP=1 -q -U rooroom_owner -d rooroom \
  -v name="$NAME" -v email="$EMAIL" -v pw="$PW" <<'SQL'
BEGIN;
WITH u AS (
  INSERT INTO users (email, password_hash, email_verified_at)
  VALUES (:'email', crypt(:'pw', gen_salt('bf', 10)), now()) RETURNING id
)
INSERT INTO profiles (id, display_name, role) SELECT id, :'name', 'professor' FROM u;
-- Raises (and rolls everything back) if the name is not on the imported schedule.
SELECT link_professor((SELECT id FROM users WHERE email = :'email'), :'name') AS rooms_linked;
COMMIT;
SQL
echo "Professor account ready: $EMAIL  one-time password: $PW"
