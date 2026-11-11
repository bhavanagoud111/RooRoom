-- Row Level Security, grants and the few SECURITY DEFINER functions.
-- Each API request opens a transaction and runs SET LOCAL app.user_id = '<signed-in user>'.
-- The app, the AI agents and the MCP server all connect as rooroom_app, so these policies
-- apply to every query they make. There is no all-courses service account.

-- ================================================================ helpers
CREATE FUNCTION app_uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION is_member(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM enrollments WHERE course_id = c AND user_id = app_uid())
$$;

CREATE FUNCTION is_prof(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM courses WHERE id = c AND professor_id = app_uid())
      OR EXISTS (SELECT 1 FROM enrollments WHERE course_id = c AND user_id = app_uid()
                 AND role_in_course = 'professor')
$$;

CREATE FUNCTION is_thread_member(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM thread_members WHERE thread_id = t AND user_id = app_uid())
$$;

CREATE FUNCTION can_see_profile(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_uid() IS NOT NULL AND (
         p = app_uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = p AND role = 'professor')
      OR EXISTS (SELECT 1 FROM thread_members a JOIN thread_members b USING (thread_id)
                 WHERE a.user_id = app_uid() AND b.user_id = p)
      OR EXISTS (SELECT 1 FROM profiles pr
                 JOIN enrollments e1 ON e1.user_id = pr.id
                 JOIN enrollments e2 ON e2.course_id = e1.course_id AND e2.user_id = app_uid()
                 WHERE pr.id = p AND pr.visible_to_classmates))
$$;

CREATE FUNCTION is_note_author(n uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM note_authors WHERE note_id = n AND author_id = app_uid())
$$;

-- ================================================================ auth (definer functions only)
-- rooroom_app has no grant on users, sessions or email_verifications. It can only call these.
CREATE FUNCTION auth_signup(p_email text, p_hash text, p_name text, p_code_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  INSERT INTO users (email, password_hash) VALUES (p_email, p_hash) RETURNING id INTO uid;
  -- Sign-up only ever creates students. Professor accounts are provisioned by the university.
  INSERT INTO profiles (id, display_name, role) VALUES (uid, p_name, 'student');
  INSERT INTO email_verifications (user_id, code_hash, expires_at)
       VALUES (uid, p_code_hash, now() + interval '30 minutes');
  RETURN uid;
END $$;

CREATE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (id uuid, password_hash text, verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, password_hash, email_verified_at IS NOT NULL FROM users WHERE email = p_email
$$;

CREATE FUNCTION auth_verify_email(p_email text, p_code_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  SELECT u.id INTO uid FROM users u JOIN email_verifications v ON v.user_id = u.id
   WHERE u.email = p_email AND v.code_hash = p_code_hash AND v.expires_at > now();
  IF uid IS NULL THEN RETURN false; END IF;
  UPDATE users SET email_verified_at = now() WHERE id = uid;
  DELETE FROM email_verifications WHERE user_id = uid;
  RETURN true;
END $$;

CREATE FUNCTION auth_create_session(p_user uuid, p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (p_user, p_token_hash, now() + interval '7 days')
$$;

-- Sessions expire after 2 hours idle or 7 days total. No lifetime tokens.
CREATE FUNCTION auth_resolve_session(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  UPDATE sessions SET last_seen_at = now()
   WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
     AND last_seen_at > now() - interval '2 hours'
  RETURNING user_id INTO uid;
  RETURN uid;
END $$;

CREATE FUNCTION auth_revoke_session(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash
$$;

-- Incident response: revoke every session and MCP token at once.
CREATE FUNCTION revoke_everything() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sessions   SET revoked_at = now() WHERE revoked_at IS NULL;
  UPDATE mcp_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION revoke_everything() FROM PUBLIC;

-- MCP: resolve a bearer token to its user. Read-only, expiring, revocable.
CREATE FUNCTION mcp_resolve(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  UPDATE mcp_tokens SET last_used_at = now()
   WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
  RETURNING user_id INTO uid;
  RETURN uid;
END $$;

-- ================================================================ chat thread creation
-- Validates every member: enrolled, a student, visible to classmates, and not blocking the creator.
CREATE FUNCTION create_thread(p_course uuid, p_members uuid[], p_title text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; m uuid; me uuid := app_uid(); existing uuid;
BEGIN
  IF me IS NULL OR NOT is_member(p_course) THEN RAISE EXCEPTION 'not enrolled'; END IF;
  IF array_length(p_members, 1) IS NULL OR array_length(p_members, 1) > 7 THEN
    RAISE EXCEPTION 'a thread has 1 to 7 other members';
  END IF;
  FOREACH m IN ARRAY p_members LOOP
    IF m = me THEN RAISE EXCEPTION 'cannot add yourself'; END IF;
    IF NOT EXISTS (SELECT 1 FROM enrollments e JOIN profiles p ON p.id = e.user_id
                   WHERE e.user_id = m AND e.course_id = p_course AND p.role = 'student'
                     AND e.role_in_course = 'student' AND p.visible_to_classmates) THEN
      RAISE EXCEPTION 'member is not a visible classmate in this course';
    END IF;
    IF EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = m AND blocked_id = me)
                                       OR (blocker_id = me AND blocked_id = m)) THEN
      RAISE EXCEPTION 'blocked';
    END IF;
  END LOOP;
  -- Reuse an existing one-to-one thread.
  IF array_length(p_members, 1) = 1 THEN
    SELECT t.id INTO existing FROM threads t
      JOIN thread_members a ON a.thread_id = t.id AND a.user_id = me
      JOIN thread_members b ON b.thread_id = t.id AND b.user_id = p_members[1]
     WHERE t.course_id = p_course AND NOT t.is_group LIMIT 1;
    IF existing IS NOT NULL THEN RETURN existing; END IF;
  END IF;
  INSERT INTO threads (course_id, is_group, title, created_by)
       VALUES (p_course, array_length(p_members, 1) > 1, nullif(p_title, ''), me) RETURNING id INTO tid;
  INSERT INTO thread_members VALUES (tid, me);
  INSERT INTO thread_members SELECT tid, unnest(p_members);
  RETURN tid;
END $$;

CREATE FUNCTION is_blocked_in_thread(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM thread_members tm JOIN blocks b
                   ON (b.blocker_id = tm.user_id AND b.blocked_id = app_uid())
                   OR (b.blocked_id = tm.user_id AND b.blocker_id = app_uid())
                 WHERE tm.thread_id = t AND tm.user_id <> app_uid()
                   AND NOT (SELECT is_group FROM threads WHERE id = t))
$$;

-- ================================================================ anonymous notes for the author
-- The student can list their own notes and replies. The professor never can.
CREATE FUNCTION my_notes(p_course uuid)
RETURNS TABLE (id uuid, status note_status, moderation_labels text[], body_original text,
               created_at timestamptz, delivered_at timestamptz, deliver_after timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.status, n.moderation_labels, n.body_original, n.created_at, n.delivered_at, n.deliver_after
    FROM anon_notes n JOIN note_authors a ON a.note_id = n.id
   WHERE a.author_id = app_uid() AND n.course_id = p_course
   ORDER BY n.created_at DESC
$$;

CREATE FUNCTION my_notes_this_week(p_course uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM anon_notes n JOIN note_authors a ON a.note_id = n.id
   WHERE a.author_id = app_uid() AND n.course_id = p_course AND n.created_at > now() - interval '7 days'
$$;

-- Translation cache: exact lookups only, so the cache cannot be listed.
CREATE FUNCTION translation_get(p_hash text, p_lang text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT translated FROM translations WHERE text_hash = p_hash AND target_lang = p_lang
$$;
CREATE FUNCTION translation_put(p_hash text, p_lang text, p_text text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO translations VALUES (p_hash, p_lang, p_text) ON CONFLICT DO NOTHING
$$;

CREATE FUNCTION raise_alert(p_kind text, p_detail jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO security_alerts (user_id, kind, detail) VALUES (app_uid(), p_kind, p_detail)
$$;

-- Class size for the small-class anonymity warning, without exposing the roster.
CREATE FUNCTION class_size(p_course uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM enrollments WHERE course_id = p_course AND role_in_course = 'student'
$$;

-- ================================================================ chat push
CREATE FUNCTION notify_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('rooroom_chat', json_build_object('thread_id', NEW.thread_id, 'message_id', NEW.id)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER messages_notify AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION notify_message();

-- ================================================================ grants
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rooroom_app, rooroom_worker, rooroom_moderator;

-- rooroom_app
GRANT SELECT ON profiles TO rooroom_app;
GRANT UPDATE (display_name, preferred_language, timezone, visible_to_classmates,
              activity_course_id, activity_line, activity_at) ON profiles TO rooroom_app;
GRANT SELECT ON courses TO rooroom_app;
GRANT UPDATE (cluster_threshold, similarity_cutoff, notes_enabled, notes_muted_until, notes_weekly_limit)
      ON courses TO rooroom_app;
GRANT SELECT, INSERT, DELETE ON enrollments TO rooroom_app;
GRANT SELECT, INSERT, DELETE ON documents TO rooroom_app;
GRANT SELECT, INSERT ON chunks TO rooroom_app;
GRANT SELECT, UPDATE (status, summary) ON clusters TO rooroom_app;
GRANT SELECT, INSERT, DELETE ON clarifications TO rooroom_app;
GRANT SELECT, INSERT ON questions TO rooroom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO rooroom_app;
GRANT SELECT ON threads, thread_members TO rooroom_app;
GRANT SELECT, INSERT ON messages TO rooroom_app;
GRANT SELECT, INSERT, DELETE ON blocks TO rooroom_app;
GRANT SELECT, INSERT ON reports TO rooroom_app;
GRANT SELECT, INSERT ON anon_notes TO rooroom_app;
GRANT INSERT ON note_authors TO rooroom_app;          -- write-only: no SELECT, ever
GRANT SELECT, INSERT ON note_replies TO rooroom_app;
GRANT SELECT ON strikes TO rooroom_app;
GRANT SELECT, INSERT, UPDATE (revoked_at) ON mcp_tokens TO rooroom_app;
GRANT SELECT, INSERT ON usage_events, audit_log TO rooroom_app;
GRANT SELECT ON security_alerts TO rooroom_app;
GRANT USAGE ON SEQUENCE chunks_id_seq, usage_events_id_seq, audit_log_id_seq TO rooroom_app;

-- rooroom_worker: ingestion only
GRANT SELECT, UPDATE (status, status_note, page_count) ON documents TO rooroom_worker;
GRANT SELECT, INSERT, DELETE ON chunks TO rooroom_worker;
GRANT SELECT ON courses, enrollments TO rooroom_worker;
GRANT INSERT ON events TO rooroom_worker;
GRANT USAGE ON SEQUENCE chunks_id_seq TO rooroom_worker;

-- rooroom_moderator: clustering, digests, note screening and delivery
GRANT SELECT ON courses, enrollments TO rooroom_moderator;
GRANT SELECT (id, course_id, text_redacted, embedding, cluster_id, module, status, created_at),
      UPDATE (cluster_id, status) ON questions TO rooroom_moderator;
GRANT SELECT, INSERT, UPDATE ON clusters TO rooroom_moderator;
GRANT SELECT, UPDATE ON anon_notes TO rooroom_moderator;
GRANT SELECT ON note_authors TO rooroom_moderator;
GRANT SELECT, INSERT, UPDATE ON strikes TO rooroom_moderator;
GRANT SELECT, UPDATE (status) ON reports TO rooroom_moderator;
GRANT INSERT ON audit_log TO rooroom_moderator;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO rooroom_moderator;

-- ================================================================ row level security
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','courses','enrollments','documents','chunks','clusters',
    'clarifications','questions','events','threads','thread_members','messages','blocks','reports',
    'anon_notes','note_authors','note_replies','strikes','mcp_tokens','usage_events','audit_log',
    'security_alerts','users','sessions','email_verifications','translations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- profiles
CREATE POLICY p_sel ON profiles FOR SELECT TO rooroom_app USING (can_see_profile(id));
CREATE POLICY p_upd ON profiles FOR UPDATE TO rooroom_app USING (id = app_uid()) WITH CHECK (id = app_uid());

-- courses: the catalogue is visible to any signed-in user; settings only to the course's professor
CREATE POLICY c_sel ON courses FOR SELECT TO rooroom_app USING (app_uid() IS NOT NULL);
CREATE POLICY c_upd ON courses FOR UPDATE TO rooroom_app USING (is_prof(id)) WITH CHECK (is_prof(id));
CREATE POLICY c_worker ON courses FOR SELECT TO rooroom_worker USING (true);
CREATE POLICY c_mod ON courses FOR SELECT TO rooroom_moderator USING (true);

-- enrollments: see your own and your classmates' rows; students enrol themselves as students
CREATE POLICY e_sel ON enrollments FOR SELECT TO rooroom_app USING (user_id = app_uid() OR is_member(course_id));
CREATE POLICY e_ins ON enrollments FOR INSERT TO rooroom_app
  WITH CHECK (user_id = app_uid() AND role_in_course = 'student'
              AND (SELECT role FROM profiles WHERE id = app_uid()) = 'student');
CREATE POLICY e_del ON enrollments FOR DELETE TO rooroom_app USING (user_id = app_uid() AND role_in_course = 'student');
CREATE POLICY e_worker ON enrollments FOR SELECT TO rooroom_worker USING (true);
CREATE POLICY e_mod ON enrollments FOR SELECT TO rooroom_moderator USING (true);

-- documents: class documents to the class, private uploads to the uploader only.
-- Only the course's professor can publish to the class.
CREATE POLICY d_sel ON documents FOR SELECT TO rooroom_app
  USING (is_member(course_id) AND (visibility = 'class' OR uploader_id = app_uid()));
CREATE POLICY d_ins ON documents FOR INSERT TO rooroom_app
  WITH CHECK (uploader_id = app_uid() AND is_member(course_id)
              AND (visibility = 'private' OR is_prof(course_id)));
CREATE POLICY d_del ON documents FOR DELETE TO rooroom_app USING (uploader_id = app_uid());
CREATE POLICY d_worker ON documents FOR ALL TO rooroom_worker USING (true) WITH CHECK (true);

-- chunks
CREATE POLICY ch_sel ON chunks FOR SELECT TO rooroom_app
  USING (is_member(course_id) AND (visibility = 'class' OR owner_id = app_uid()));
CREATE POLICY ch_ins ON chunks FOR INSERT TO rooroom_app
  WITH CHECK (clarification_id IS NOT NULL AND is_prof(course_id) AND owner_id = app_uid());
CREATE POLICY ch_worker ON chunks FOR ALL TO rooroom_worker USING (true) WITH CHECK (true);

-- clusters: the professor sees only clusters at or above the course threshold
CREATE POLICY cl_sel ON clusters FOR SELECT TO rooroom_app
  USING (is_prof(course_id)
         AND question_count >= (SELECT cluster_threshold FROM courses WHERE id = course_id));
CREATE POLICY cl_upd ON clusters FOR UPDATE TO rooroom_app USING (is_prof(course_id)) WITH CHECK (is_prof(course_id));
CREATE POLICY cl_mod ON clusters FOR ALL TO rooroom_moderator USING (true) WITH CHECK (true);

-- clarifications
CREATE POLICY cf_sel ON clarifications FOR SELECT TO rooroom_app USING (is_member(course_id));
CREATE POLICY cf_ins ON clarifications FOR INSERT TO rooroom_app
  WITH CHECK (is_prof(course_id) AND author_id = app_uid() AND author_role = 'professor');
CREATE POLICY cf_del ON clarifications FOR DELETE TO rooroom_app USING (is_prof(course_id));

-- questions: a student sees their own. No professor policy exists.
CREATE POLICY q_sel ON questions FOR SELECT TO rooroom_app USING (author_id = app_uid());
CREATE POLICY q_ins ON questions FOR INSERT TO rooroom_app
  WITH CHECK (author_id = app_uid() AND author_role = 'student' AND is_member(course_id) AND NOT is_prof(course_id));
CREATE POLICY q_mod ON questions FOR ALL TO rooroom_moderator USING (true) WITH CHECK (true);

-- events: your own calendar only
CREATE POLICY ev_all ON events FOR ALL TO rooroom_app USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
CREATE POLICY ev_worker ON events FOR INSERT TO rooroom_worker
  WITH CHECK (source = 'syllabus' AND status = 'suggested' AND author_role = 'system');

-- chat
CREATE POLICY t_sel ON threads FOR SELECT TO rooroom_app USING (is_thread_member(id));
CREATE POLICY tm_sel ON thread_members FOR SELECT TO rooroom_app USING (is_thread_member(thread_id));
CREATE POLICY m_sel ON messages FOR SELECT TO rooroom_app USING (is_thread_member(thread_id));
CREATE POLICY m_ins ON messages FOR INSERT TO rooroom_app
  WITH CHECK (sender_id = app_uid() AND author_role = 'student' AND is_thread_member(thread_id)
              AND NOT is_blocked_in_thread(thread_id));
CREATE POLICY b_all ON blocks FOR ALL TO rooroom_app USING (blocker_id = app_uid()) WITH CHECK (blocker_id = app_uid());
CREATE POLICY r_sel ON reports FOR SELECT TO rooroom_app USING (reporter_id = app_uid());
CREATE POLICY r_ins ON reports FOR INSERT TO rooroom_app WITH CHECK (reporter_id = app_uid());
CREATE POLICY r_mod ON reports FOR ALL TO rooroom_moderator USING (true) WITH CHECK (true);

-- anonymous notes: the professor reads delivered notes only. The app can never mark a note delivered.
CREATE POLICY n_sel ON anon_notes FOR SELECT TO rooroom_app USING (is_prof(course_id) AND status = 'delivered');
CREATE POLICY n_ins ON anon_notes FOR INSERT TO rooroom_app
  WITH CHECK (is_member(course_id) AND NOT is_prof(course_id) AND author_role = 'student'
              AND status IN ('held', 'blocked', 'queued') AND delivered_at IS NULL);
CREATE POLICY n_mod ON anon_notes FOR ALL TO rooroom_moderator USING (true) WITH CHECK (true);
CREATE POLICY na_ins ON note_authors FOR INSERT TO rooroom_app WITH CHECK (author_id = app_uid());
CREATE POLICY na_mod ON note_authors FOR SELECT TO rooroom_moderator USING (true);
CREATE POLICY nr_sel ON note_replies FOR SELECT TO rooroom_app
  USING (is_note_author(note_id) OR is_prof((SELECT course_id FROM anon_notes n WHERE n.id = note_id)));
CREATE POLICY nr_ins ON note_replies FOR INSERT TO rooroom_app
  WITH CHECK (author_id = app_uid() AND author_role = 'professor'
              AND is_prof((SELECT course_id FROM anon_notes n WHERE n.id = note_id)));
CREATE POLICY s_sel ON strikes FOR SELECT TO rooroom_app USING (user_id = app_uid());
CREATE POLICY s_mod ON strikes FOR ALL TO rooroom_moderator USING (true) WITH CHECK (true);

-- tokens, usage, audit
CREATE POLICY mt_all ON mcp_tokens FOR ALL TO rooroom_app USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
CREATE POLICY ue_all ON usage_events FOR ALL TO rooroom_app USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
CREATE POLICY al_sel ON audit_log FOR SELECT TO rooroom_app USING (user_id = app_uid());
CREATE POLICY al_ins ON audit_log FOR INSERT TO rooroom_app WITH CHECK (user_id = app_uid());
CREATE POLICY al_mod ON audit_log FOR INSERT TO rooroom_moderator WITH CHECK (true);
CREATE POLICY sa_sel ON security_alerts FOR SELECT TO rooroom_app USING (user_id = app_uid());
-- users, sessions, email_verifications, translations: no policies, so no direct access at all.
