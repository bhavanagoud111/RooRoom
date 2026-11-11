#!/bin/bash
# Creates the three non-owner database roles. None of them can bypass Row Level Security.
#   rooroom_app       - the web app, chat server and MCP server. Every query runs as the signed-in user.
#   rooroom_worker    - the ingestion worker. Can only touch documents, chunks and syllabus events.
#   rooroom_moderator - the moderation service. The only role that can read who wrote an anonymous note.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE rooroom_app       LOGIN PASSWORD '${APP_DB_PASSWORD}'       NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE rooroom_worker    LOGIN PASSWORD '${WORKER_DB_PASSWORD}'    NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE rooroom_moderator LOGIN PASSWORD '${MODERATOR_DB_PASSWORD}' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO rooroom_app, rooroom_worker, rooroom_moderator;
SQL
