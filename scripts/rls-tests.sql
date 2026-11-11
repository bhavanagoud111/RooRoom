-- Row Level Security tests. Run as rooroom_app (the role every feature uses):
--   scripts/redteam.sh   (runs this file, then the API red-team checks)
-- Each block raises an exception on failure, so psql -v ON_ERROR_STOP=1 exits non-zero.
\set QUIET on
\pset tuples_only on


DO $$
DECLARE
  priya uuid; diego uuid; okafor uuid; lindqvist uuid; c5520 uuid; c5565 uuid; c5530 uuid;
  n int; ok boolean;
BEGIN
  -- Look up ids. Profiles of professors are visible to anyone signed in, students only to classmates,
  -- so resolve them as a professor's session first.
  PERFORM set_config('app.user_id', (SELECT id::text FROM profiles WHERE display_name = 'Dr. Maya Okafor'), true);
  okafor := app_uid();
  SELECT id INTO c5520 FROM courses WHERE code = 'COMP-SCI 5520';
  SELECT id INTO c5565 FROM courses WHERE code = 'COMP-SCI 5565';
  SELECT id INTO c5530 FROM courses WHERE code = 'COMP-SCI 5530';
  SELECT id INTO lindqvist FROM profiles WHERE display_name = 'Dr. Erik Lindqvist';
  RAISE NOTICE 'ok    ids resolved';

  -- 1. Professors cannot read individual questions at all (only clusters).
  SELECT count(*) INTO n FROM questions;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL professor can read % questions', n; END IF;
  RAISE NOTICE 'ok    professor sees 0 individual questions';

  -- 2. Professor cannot read note authors.
  BEGIN
    PERFORM 1 FROM note_authors LIMIT 1;
    RAISE EXCEPTION 'FAIL professor could read note_authors';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    note_authors refused to the app role';
  END;

  -- 3. Professor sees only clusters at or above the threshold in their own course.
  SELECT count(*) INTO n FROM clusters c JOIN courses k ON k.id = c.course_id
   WHERE c.question_count < k.cluster_threshold OR NOT is_prof(c.course_id);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL professor sees % clusters below threshold or outside their courses', n; END IF;
  RAISE NOTICE 'ok    professor sees no cluster below the threshold or outside their course';

  -- 4. Professor of 5520 cannot change another professor's course settings.
  UPDATE courses SET notes_enabled = false WHERE id = c5565;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL professor changed another course'; END IF;
  RAISE NOTICE 'ok    professor cannot change another professor''s course';

  -- Switch to a student.
  SELECT p.id INTO priya FROM profiles p WHERE p.display_name = 'Priya Raman';
  PERFORM set_config('app.user_id', priya::text, true);
  SELECT p.id INTO diego FROM profiles p WHERE p.display_name LIKE 'Diego%';

  -- 5. Student cannot see documents or chunks of a course they are not in.
  SELECT count(*) INTO n FROM documents WHERE course_id = c5530;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees documents of an unenrolled course'; END IF;
  SELECT count(*) INTO n FROM chunks ch WHERE NOT is_member(ch.course_id);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees % chunks outside their courses', n; END IF;
  RAISE NOTICE 'ok    student sees no documents or chunks outside their courses';

  -- 6. Student cannot see a classmate's private uploads or chunks.
  SELECT count(*) INTO n FROM documents WHERE visibility = 'private' AND uploader_id <> priya;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees a classmate''s private upload'; END IF;
  SELECT count(*) INTO n FROM chunks WHERE visibility = 'private' AND owner_id <> priya;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees a classmate''s private chunks'; END IF;
  RAISE NOTICE 'ok    private uploads stay private';

  -- 7. Student cannot publish a document to the whole class.
  BEGIN
    INSERT INTO documents (course_id, uploader_id, author_role, visibility, kind, title, filename, storage_key, size_bytes)
    VALUES (c5520, priya, 'student', 'class', 'module', 'x', 'x.pdf', 'x', 1);
    RAISE EXCEPTION 'FAIL student published a class document';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    student cannot publish to the class';
  END;

  -- 8. Student cannot write a question as someone else, or as a professor.
  BEGIN
    INSERT INTO questions (course_id, author_id, text_original) VALUES (c5520, diego, 'spoofed question');
    RAISE EXCEPTION 'FAIL student wrote a question as someone else';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    question author cannot be spoofed';
  END;

  -- 9. Student cannot create an already-delivered note (bypassing screening).
  BEGIN
    INSERT INTO anon_notes (course_id, body_original, status) VALUES (c5520, 'x', 'delivered');
    RAISE EXCEPTION 'FAIL student delivered a note directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    notes cannot skip screening';
  END;

  -- 10. Student cannot enrol as a professor, or enrol someone else.
  BEGIN
    INSERT INTO enrollments (user_id, course_id, role_in_course) VALUES (priya, c5530, 'professor');
    RAISE EXCEPTION 'FAIL student enrolled as professor';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    student cannot enrol as a professor';
  END;
  BEGIN
    INSERT INTO enrollments (user_id, course_id, role_in_course) VALUES (diego, c5530, 'student');
    RAISE EXCEPTION 'FAIL student enrolled someone else';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    student cannot enrol someone else';
  END;

  -- 11. Student cannot promote themselves (role column is not updatable).
  BEGIN
    UPDATE profiles SET role = 'professor' WHERE id = priya;
    RAISE EXCEPTION 'FAIL student changed their role';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    student cannot change their role';
  END;

  -- 12. Student cannot see other students' events, or messages in threads they are not in.
  SELECT count(*) INTO n FROM events WHERE user_id <> priya;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees others'' calendar'; END IF;
  SELECT count(*) INTO n FROM messages m WHERE NOT is_thread_member(m.thread_id);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees others'' messages'; END IF;
  RAISE NOTICE 'ok    calendars and chats are private';

  -- 12b. Notifications: a user sees only their own, and cannot create one.
  SELECT count(*) INTO n FROM notifications WHERE user_id <> priya;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student sees others'' notifications'; END IF;
  BEGIN
    INSERT INTO notifications (user_id, kind, title, link) VALUES (diego, 'x', 'spoof', '/');
    RAISE EXCEPTION 'FAIL app can write notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM notify_user(diego, NULL, 'x', NULL, 'spoof', NULL, '/');
    RAISE EXCEPTION 'FAIL app can call notify_user';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok    notifications are private and only the database writes them';

  -- 13. Users, sessions and the translation cache are unreadable directly.
  BEGIN
    PERFORM 1 FROM users LIMIT 1;
    RAISE EXCEPTION 'FAIL app can read users';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM sessions LIMIT 1;
    RAISE EXCEPTION 'FAIL app can read sessions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM translations LIMIT 1;
    RAISE EXCEPTION 'FAIL app can list the translation cache';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok    users, sessions and translation cache are not readable';

  -- 14b. The imported catalogue is read-only, and nobody can make themselves a professor.
  BEGIN
    INSERT INTO instructors (name) VALUES ('Forged Professor');
    RAISE EXCEPTION 'FAIL student created an instructor';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE courses SET professor_id = priya WHERE source = 'umkc_schedule';
    RAISE EXCEPTION 'FAIL student set themselves as professor';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM link_professor(priya, 'Rafida Zaman');
    RAISE EXCEPTION 'FAIL student called link_professor';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok    catalogue is read-only and professor links are operator-only';

  -- 14. Signed out (no app.user_id): nothing is visible.
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO n FROM courses;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL signed-out session sees courses'; END IF;
  SELECT count(*) INTO n FROM profiles;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL signed-out session sees profiles'; END IF;
  RAISE NOTICE 'ok    a request without a user sees nothing';

  -- 15. The app role cannot call the incident kill switch.
  BEGIN
    PERFORM revoke_everything();
    RAISE EXCEPTION 'FAIL app role can revoke every session';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok    revoke_everything is reserved for the operator';
  END;
END $$;
