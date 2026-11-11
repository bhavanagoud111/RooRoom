-- Study buddies: shared free time without exposing anyone's calendar.
-- Returns only busy intervals (no titles, no courses) of a visible classmate in a course the
-- caller is enrolled in. Professors, hidden students and anyone in a block relationship get nothing.
CREATE OR REPLACE FUNCTION buddy_busy(p_course uuid, p_other uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ev.starts_at, ev.ends_at
    FROM events ev
   WHERE ev.user_id = p_other
     AND ev.status = 'confirmed'
     AND ev.ends_at > p_from AND ev.starts_at < p_to
     AND p_to - p_from <= interval '15 days'
     AND p_other <> app_uid()
     AND is_member(p_course)
     AND EXISTS (SELECT 1 FROM enrollments e JOIN profiles p ON p.id = e.user_id
                  WHERE e.user_id = p_other AND e.course_id = p_course
                    AND e.role_in_course = 'student' AND p.role = 'student' AND p.visible_to_classmates)
     AND NOT EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = app_uid() AND b.blocked_id = p_other)
                         OR (b.blocker_id = p_other AND b.blocked_id = app_uid()))
   ORDER BY ev.starts_at
$$;
REVOKE EXECUTE ON FUNCTION buddy_busy(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buddy_busy(uuid, uuid, timestamptz, timestamptz) TO rooroom_app;
