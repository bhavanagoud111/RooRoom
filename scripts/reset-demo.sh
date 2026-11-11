#!/bin/sh
# Clears all course content (keeps accounts, courses and enrolments), then reseeds the demo.
# Use before a presentation:  ./scripts/reset-demo.sh
set -e
cd "$(dirname "$0")/.."
docker exec -i rooroom-db-1 psql -v ON_ERROR_STOP=1 -q -U rooroom_owner -d rooroom <<'SQL'
TRUNCATE documents, chunks, questions, clusters, clarifications, anon_notes, note_authors, note_replies,
         strikes, events, threads, thread_members, messages, blocks, reports, usage_events, audit_log,
         security_alerts, mcp_tokens, sessions, notifications CASCADE;
DELETE FROM enrollments WHERE role_in_course = 'student' AND course_id IN (SELECT id FROM courses WHERE source <> 'demo');
DELETE FROM courses WHERE source = 'umkc_catalog';
UPDATE profiles SET activity_course_id = NULL, activity_line = NULL, activity_at = NULL;
UPDATE profiles SET visible_to_classmates = true
 WHERE display_name IN ('Priya Raman','Diego Fernández','Wei Zhang','Amara Okeke','Omar Haddad','Sofia Rossi',
                        'Lena Fischer','Kenji Sato','Lucas Silva','Hana Kim');
UPDATE courses SET cluster_threshold = 3, similarity_cutoff = 0.80, notes_enabled = true,
                   notes_muted_until = NULL, notes_weekly_limit = 3;
SQL
echo "content cleared"
node scripts/seed-demo.mjs
