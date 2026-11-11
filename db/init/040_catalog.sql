-- The real UMKC catalogue and Fall schedule (imported by scripts/import_umkc.py).
--
--   catalog_courses  every course in the UMKC catalogue, all subjects and levels
--   instructors      every instructor named on the public class schedule (name only)
--   courses          a ROOM = one catalogue course + one term + one instructor.
--                    Students pick the professor they actually have when they join.
--   course_sections  the scheduled sections behind each room (times, component, class number)
--
-- Instructors are names until the university provisions an account; then profile_id links them
-- and every room they teach gets professor_id, which is what the professor policies check.

CREATE TABLE catalog_courses (
  code          text PRIMARY KEY,
  subject       text NOT NULL,
  number        text NOT NULL,
  title         text NOT NULL,
  credits       text,
  description   text,
  prerequisites text,
  level         text,
  subject_name  text,
  search        tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', coalesce(code, '') || ' ' || coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(subject_name, '')), 'B') ||
                  setweight(to_tsvector('english', coalesce(description, '')), 'C')) STORED
);
CREATE INDEX ON catalog_courses USING gin (search);
CREATE INDEX ON catalog_courses (subject, number);

CREATE TABLE instructors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,
  profile_id uuid UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE courses ADD COLUMN catalog_code  text REFERENCES catalog_courses(code);
ALTER TABLE courses ADD COLUMN instructor_id uuid REFERENCES instructors(id);
ALTER TABLE courses ADD COLUMN source        text NOT NULL DEFAULT 'demo';  -- demo | umkc_schedule | umkc_catalog
ALTER TABLE courses ADD COLUMN credits       text;
ALTER TABLE courses DROP CONSTRAINT courses_code_term_key;
CREATE UNIQUE INDEX courses_room_key ON courses (code, term, coalesce(instructor_id, '00000000-0000-0000-0000-000000000000'::uuid), source);
CREATE INDEX ON courses (catalog_code);

CREATE TABLE course_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term        text NOT NULL,
  class_nbr   text NOT NULL,
  section     text,
  component   text,
  days_times  text,
  dates       text,
  instructor_names text[] NOT NULL DEFAULT '{}',
  UNIQUE (course_id, class_nbr)
);
CREATE INDEX ON course_sections (course_id);

-- Public facts: readable by anyone signed in, writable by nobody but the importer (owner).
GRANT SELECT ON catalog_courses, instructors, course_sections TO rooroom_app;
ALTER TABLE catalog_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_courses FORCE ROW LEVEL SECURITY;
ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructors FORCE ROW LEVEL SECURITY;
ALTER TABLE course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_sections FORCE ROW LEVEL SECURITY;
CREATE POLICY cc_sel ON catalog_courses FOR SELECT TO rooroom_app USING (app_uid() IS NOT NULL);
CREATE POLICY in_sel ON instructors FOR SELECT TO rooroom_app USING (app_uid() IS NOT NULL);
CREATE POLICY cs_sel ON course_sections FOR SELECT TO rooroom_app USING (app_uid() IS NOT NULL);

-- A catalogue course that is not on this term's schedule can still get a room (no professor yet).
-- Creates it on first use; returns the existing one otherwise. Students only.
CREATE FUNCTION open_catalog_room(p_code text, p_term text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid; cc catalog_courses;
BEGIN
  IF app_uid() IS NULL OR (SELECT role FROM profiles WHERE id = app_uid()) <> 'student' THEN
    RAISE EXCEPTION 'students only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO cc FROM catalog_courses WHERE code = p_code;
  IF cc.code IS NULL THEN RAISE EXCEPTION 'unknown course'; END IF;
  SELECT id INTO cid FROM courses
   WHERE catalog_code = p_code AND term = p_term AND instructor_id IS NULL ORDER BY source = 'umkc_schedule' DESC LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO courses (code, title, term, description, catalog_code, source, credits, color)
    VALUES (cc.code, cc.title, p_term, cc.description, cc.code, 'umkc_catalog', cc.credits, subject_color(cc.subject))
    RETURNING id INTO cid;
  END IF;
  RETURN cid;
END $$;

-- Stable colour per subject so every course from one department looks related.
CREATE FUNCTION subject_color(p_subject text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['#2F6FED','#0F9D7A','#C2410C','#7C3AED','#DB2777','#0891B2','#B91C1C','#4D7C0F',
                '#A16207','#475569','#9333EA','#0E7490','#BE185D','#15803D','#1D4ED8','#B45309'])
         [1 + abs(hashtext(p_subject)) % 16]
$$;

-- Provisioning a professor (run by the operator, never by the app): links an account to the
-- instructor record and makes them the professor of every room they teach.
CREATE FUNCTION link_professor(p_profile uuid, p_instructor_name text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE iid uuid; n int;
BEGIN
  SELECT id INTO iid FROM instructors WHERE name = p_instructor_name;
  IF iid IS NULL THEN RAISE EXCEPTION 'no instructor named %', p_instructor_name; END IF;
  UPDATE instructors SET profile_id = p_profile WHERE id = iid;
  UPDATE courses SET professor_id = p_profile WHERE instructor_id = iid;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO enrollments (user_id, course_id, role_in_course)
  SELECT p_profile, id, 'professor' FROM courses WHERE instructor_id = iid
  ON CONFLICT (user_id, course_id) DO UPDATE SET role_in_course = 'professor';
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION link_professor(uuid, text) FROM PUBLIC;
