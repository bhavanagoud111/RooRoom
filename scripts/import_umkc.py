"""Loads data/umkc/catalog.json and data/umkc/schedule_<term>.json into the running database.

    python3 scripts/import_umkc.py --term 5443 --label "Fall 2026"

Safe to rerun: everything is an upsert. Rooms are built like this:
  - every instructor named on a lecture-type section (not a lab) of a course gets a room for it;
  - if a course only names instructors on labs, those instructors get the rooms;
  - if nobody is named yet, the course gets one room with no professor.
Each room keeps the sections its instructor appears on, so students can see the times.
The old placeholder demo courses without a professor are removed (the demo course and the two
other demo professors' courses stay, marked as demo).
"""
import argparse
import json
import os
import subprocess
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data", "umkc")


def build(term_label, catalog, schedule):
    by_code = defaultdict(list)
    for s in schedule:
        by_code[s["code"]].append(s)

    known = {c["code"] for c in catalog}
    extra_catalog = []
    for code, secs in by_code.items():
        if code not in known:  # scheduled but not in the catalogue (e.g. a new topics course)
            s = secs[0]
            extra_catalog.append({"code": code, "subject": s["subject"], "number": s["number"], "title": s["title"],
                                  "credits": None, "description": None, "prerequisites": None,
                                  "level": None, "subject_name": None})

    rooms = []
    for code, secs in by_code.items():
        lecture = [s for s in secs if s["component"] not in ("LAB",)]
        names = []
        for s in lecture:
            for n in s["instructors"]:
                if n not in names:
                    names.append(n)
        if not names:
            for s in secs:
                for n in s["instructors"]:
                    if n not in names:
                        names.append(n)
        if not names:
            rooms.append({"code": code, "instructor": None, "sections": secs})
            continue
        for n in names:
            mine = [s for s in secs if n in s["instructors"]]
            rooms.append({"code": code, "instructor": n, "sections": mine})
    return {"term": term_label, "catalog": catalog + extra_catalog, "rooms": rooms}


SQL = r"""
\set ON_ERROR_STOP on
\set content `cat /tmp/umkc_import.json`
BEGIN;
CREATE TEMP TABLE payload AS SELECT :'content'::jsonb AS j;

INSERT INTO catalog_courses (code, subject, number, title, credits, description, prerequisites, level, subject_name)
SELECT x->>'code', x->>'subject', x->>'number', x->>'title', x->>'credits', x->>'description', x->>'prerequisites',
       x->>'level', x->>'subject_name'
  FROM payload, jsonb_array_elements(j->'catalog') x
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, credits = coalesce(EXCLUDED.credits, catalog_courses.credits),
  description = coalesce(EXCLUDED.description, catalog_courses.description),
  prerequisites = coalesce(EXCLUDED.prerequisites, catalog_courses.prerequisites),
  level = coalesce(EXCLUDED.level, catalog_courses.level), subject_name = coalesce(EXCLUDED.subject_name, catalog_courses.subject_name);

INSERT INTO instructors (name)
SELECT DISTINCT r->>'instructor' FROM payload, jsonb_array_elements(j->'rooms') r WHERE r->>'instructor' IS NOT NULL
ON CONFLICT (name) DO NOTHING;

CREATE TEMP TABLE r AS
SELECT r->>'code' AS code, r->>'instructor' AS instructor, r->'sections' AS sections, (SELECT j->>'term' FROM payload) AS term
  FROM payload, jsonb_array_elements(j->'rooms') r;

INSERT INTO courses (code, title, term, description, catalog_code, instructor_id, professor_id, source, credits, color)
SELECT r.code, cc.title, r.term, cc.description, cc.code, i.id, i.profile_id, 'umkc_schedule', cc.credits, subject_color(cc.subject)
  FROM r JOIN catalog_courses cc ON cc.code = r.code LEFT JOIN instructors i ON i.name = r.instructor
ON CONFLICT (code, term, coalesce(instructor_id, '00000000-0000-0000-0000-000000000000'::uuid), source)
DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, credits = EXCLUDED.credits;

DELETE FROM course_sections WHERE course_id IN (SELECT id FROM courses WHERE source = 'umkc_schedule' AND term = (SELECT j->>'term' FROM payload));
INSERT INTO course_sections (course_id, term, class_nbr, section, component, days_times, dates, instructor_names)
SELECT c.id, r.term, s->>'class_nbr', s->>'section', s->>'component', s->>'days_times', s->>'dates',
       ARRAY(SELECT jsonb_array_elements_text(s->'instructors'))
  FROM r
  JOIN courses c ON c.code = r.code AND c.term = r.term AND c.source = 'umkc_schedule'
   AND c.instructor_id IS NOT DISTINCT FROM (SELECT id FROM instructors WHERE name = r.instructor)
  CROSS JOIN LATERAL jsonb_array_elements(r.sections) s
ON CONFLICT (course_id, class_nbr) DO NOTHING;

-- Placeholder demo courses with no professor are replaced by the real catalogue.
DELETE FROM courses WHERE source = 'demo' AND professor_id IS NULL;
-- The demo rooms (fictional professors) appear under their real catalogue course too.
UPDATE courses c SET catalog_code = c.code, credits = cc.credits
  FROM catalog_courses cc WHERE c.source = 'demo' AND cc.code = c.code;

SELECT (SELECT count(*) FROM catalog_courses) AS catalog_courses,
       (SELECT count(*) FROM instructors) AS instructors,
       (SELECT count(*) FROM courses WHERE source = 'umkc_schedule') AS schedule_rooms,
       (SELECT count(*) FROM course_sections) AS sections,
       (SELECT count(DISTINCT subject) FROM catalog_courses) AS subjects;
COMMIT;
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", default="5443")
    ap.add_argument("--label", default="Fall 2026")
    a = ap.parse_args()
    catalog = json.load(open(os.path.join(DATA, "catalog.json")))
    schedule = json.load(open(os.path.join(DATA, f"schedule_{a.term}.json")))
    payload = build(a.label, catalog, schedule)
    tmp = os.path.join(DATA, "import_payload.json")
    json.dump(payload, open(tmp, "w"), ensure_ascii=False)
    subprocess.run(["docker", "cp", tmp, "rooroom-db-1:/tmp/umkc_import.json"], check=True)
    subprocess.run(["docker", "exec", "-i", "rooroom-db-1", "psql", "-q", "-U", "rooroom_owner", "-d", "rooroom"],
                   input=SQL.encode(), check=True)
    # One colour per course (db/init/075); new courses need theirs.
    subprocess.run(["docker", "exec", "rooroom-db-1", "psql", "-q", "-U", "rooroom_owner", "-d", "rooroom",
                    "-c", "SELECT to_regproc('recolor_courses') IS NULL OR recolor_courses() >= 0"], check=True)


if __name__ == "__main__":
    main()
