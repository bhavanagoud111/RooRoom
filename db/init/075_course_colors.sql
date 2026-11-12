-- 2026-11-11: one colour per course, not per subject. Before this every COMP-SCI room had the same
-- colour, so a student's course cards all looked alike. Courses are sorted by code and walk through
-- 12 clearly different colours, so neighbouring courses (COMP-SCI 5520, 5565, 5567) differ, while
-- two rooms of the same course (same code, different professor) share one. Safe to re-run; the
-- UMKC import calls recolor_courses() again after adding courses.

CREATE OR REPLACE FUNCTION recolor_courses() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH ranked AS (
    SELECT code, dense_rank() OVER (ORDER BY code) AS rk FROM (SELECT DISTINCT code FROM courses) x
  )
  UPDATE courses c
     SET color = (ARRAY['#2F6FED','#C2410C','#0F9D7A','#7C3AED','#A16207','#0891B2',
                        '#DB2777','#15803D','#4338CA','#B91C1C','#4D7C0F','#475569'])[1 + ((r.rk - 1) % 12)]
    FROM ranked r
   WHERE c.code = r.code
     AND c.color IS DISTINCT FROM (ARRAY['#2F6FED','#C2410C','#0F9D7A','#7C3AED','#A16207','#0891B2',
                                         '#DB2777','#15803D','#4338CA','#B91C1C','#4D7C0F','#475569'])[1 + ((r.rk - 1) % 12)];
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION recolor_courses() FROM PUBLIC;

SELECT recolor_courses();

-- What a person actually sees: their own courses, sorted by code, take the 12 colours in turn, so no
-- two of one person's courses ever look alike (like a personal calendar). A course they are not in
-- (catalogue search) shows its per-course colour.
CREATE OR REPLACE FUNCTION my_course_color(p_course uuid, p_fallback text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT (ARRAY['#2F6FED','#C2410C','#0F9D7A','#7C3AED','#A16207','#0891B2',
                  '#DB2777','#15803D','#4338CA','#B91C1C','#4D7C0F','#475569'])[1 + ((x.rk - 1) % 12)]
      FROM (SELECT e.course_id, dense_rank() OVER (ORDER BY c.code, c.id) AS rk
              FROM enrollments e JOIN courses c ON c.id = e.course_id
             WHERE e.user_id = app_uid()) x
     WHERE x.course_id = p_course), p_fallback);
$$;
GRANT EXECUTE ON FUNCTION my_course_color(uuid, text) TO rooroom_app;
