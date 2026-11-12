-- 2026-11-11: important dates from a syllabus are kept once per course, not only as copies on
-- the calendars of students who happened to be enrolled when the syllabus was uploaded.
--   * the worker writes them here when it reads a syllabus (and still suggests them to students);
--   * a student who joins later gets them suggested on their calendar too;
--   * the calendar assistant reads them (plus the professor's latest announcements) through
--     my_course_dates(), so "block study time before my syllabus deadlines" works for everyone.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS course_dates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  kind        event_kind NOT NULL,
  weight      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_dates_course_idx ON course_dates (course_id, starts_at);

ALTER TABLE course_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_dates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cd_worker_ins ON course_dates;
DROP POLICY IF EXISTS cd_worker_del ON course_dates;
DROP POLICY IF EXISTS cd_worker_sel ON course_dates;
CREATE POLICY cd_worker_ins ON course_dates FOR INSERT TO rooroom_worker WITH CHECK (true);
CREATE POLICY cd_worker_del ON course_dates FOR DELETE TO rooroom_worker USING (true);
CREATE POLICY cd_worker_sel ON course_dates FOR SELECT TO rooroom_worker USING (true);
GRANT SELECT, INSERT, DELETE ON course_dates TO rooroom_worker;
REVOKE ALL ON course_dates FROM rooroom_app;

-- Recover dates from syllabi read before this table existed (one copy per course and date).
INSERT INTO course_dates (course_id, document_id, title, starts_at, ends_at, kind, weight)
SELECT DISTINCT ON (e.course_id, e.title, e.starts_at) e.course_id, e.document_id, e.title, e.starts_at, e.ends_at, e.kind, e.weight
  FROM events e
 WHERE e.source = 'syllabus' AND e.course_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM course_dates d WHERE d.course_id = e.course_id AND d.title = e.title AND d.starts_at = e.starts_at)
 ORDER BY e.course_id, e.title, e.starts_at, e.created_at;

-- For the calendar assistant: the important dates of every course the signed-in student is in,
-- whether that course has a syllabus yet, and the professor's five latest announcements/answers
-- (so an extension the professor announced wins over the syllabus date).
CREATE OR REPLACE FUNCTION my_course_dates()
RETURNS TABLE (course_code text, has_syllabus boolean, dates jsonb, professor_updates jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.code,
         EXISTS (SELECT 1 FROM documents d WHERE d.course_id = c.id AND d.kind = 'syllabus' AND d.status = 'ready'),
         coalesce((SELECT jsonb_agg(jsonb_build_object('title', x.title, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                                                       'kind', x.kind, 'weight', x.weight) ORDER BY x.starts_at)
                     FROM course_dates x WHERE x.course_id = c.id), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object('topic', u.question_summary, 'text', left(u.answer_english, 400),
                                                       'published_at', u.published_at) ORDER BY u.published_at DESC)
                     FROM (SELECT * FROM clarifications k WHERE k.course_id = c.id ORDER BY k.published_at DESC LIMIT 5) u), '[]'::jsonb)
    FROM enrollments e JOIN courses c ON c.id = e.course_id
   WHERE e.user_id = app_uid()
   ORDER BY c.code;
$$;
REVOKE EXECUTE ON FUNCTION my_course_dates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_course_dates() TO rooroom_app;

-- A student who joins after the syllabus was read still gets its dates suggested on their calendar.
CREATE OR REPLACE FUNCTION trg_enrolled_dates() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role_in_course <> 'student' THEN RETURN NEW; END IF;
  INSERT INTO events (user_id, course_id, document_id, title, starts_at, ends_at, kind, source, status, weight, author_role)
  SELECT NEW.user_id, d.course_id, d.document_id, d.title, d.starts_at, d.ends_at, d.kind, 'syllabus', 'suggested', d.weight, 'system'
    FROM course_dates d
   WHERE d.course_id = NEW.course_id AND d.starts_at > now()
     AND NOT EXISTS (SELECT 1 FROM events e WHERE e.user_id = NEW.user_id AND e.course_id = d.course_id
                                              AND e.title = d.title AND e.starts_at = d.starts_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'syllabus dates not copied on enrolment: %', SQLERRM;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enrolled_dates ON enrollments;
CREATE TRIGGER enrolled_dates AFTER INSERT ON enrollments FOR EACH ROW EXECUTE FUNCTION trg_enrolled_dates();
