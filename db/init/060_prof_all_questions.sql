-- 2026-11-08: the professor sees every anonymous question in their course, not only groups of
-- three or more, so the Summarize agent can work over all of them.
--
-- Still anonymous: this returns the redacted English text (names, IDs and identifying details
-- already removed), the topic, the status and the date. There is no author column, and the
-- professor still has no policy on the questions table itself.
CREATE FUNCTION prof_course_questions(p_course uuid)
RETURNS TABLE (id uuid, text_redacted text, module text, status question_status, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.text_redacted, q.module, q.status, q.created_at
    FROM questions q
   WHERE q.course_id = p_course AND is_prof(p_course) AND q.text_redacted IS NOT NULL
   ORDER BY q.created_at DESC
   LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION prof_course_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prof_course_questions(uuid) TO rooroom_app;
