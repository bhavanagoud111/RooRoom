import 'server-only';
import { notFound } from 'next/navigation';
import type { Me } from './auth';
import { HttpError } from './auth';
import { withUser, type Db } from './db';

export type Course = {
  id: string;
  code: string;
  title: string;
  term: string;
  description: string | null;
  color: string;
  professor_id: string | null;
  professor_name: string | null;
  cluster_threshold: number;
  similarity_cutoff: number;
  notes_enabled: boolean;
  notes_muted_until: string | null;
  notes_weekly_limit: number;
  my_role: 'student' | 'professor' | null;
  is_prof: boolean;
  class_size: number;
  /** True when the professor has a RooRoom account (they can see digests and notes). */
  professor_on_rooroom: boolean;
  source: 'demo' | 'umkc_schedule' | 'umkc_catalog';
  catalog_code: string | null;
  credits: string | null;
};

// professor_name is the account's display name, or the instructor's name from the public UMKC
// schedule when that professor has not joined RooRoom yet.
const COURSE_SQL = `
  SELECT c.*, my_course_color(c.id, c.color) AS color, coalesce(p.display_name, i.name) AS professor_name, (c.professor_id IS NOT NULL) AS professor_on_rooroom,
         e.role_in_course AS my_role, is_prof(c.id) AS is_prof, class_size(c.id) AS class_size
    FROM courses c
    LEFT JOIN profiles p ON p.id = c.professor_id
    LEFT JOIN instructors i ON i.id = c.instructor_id
    LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid()`;

export async function loadCourse(db: Db, courseId: string): Promise<Course | null> {
  if (!/^[0-9a-f-]{36}$/i.test(courseId)) return null;
  const r = await db.query(`${COURSE_SQL} WHERE c.id = $1`, [courseId]);
  return (r.rows[0] as Course) ?? null;
}

/** For pages: the course, or a 404 if the user is not enrolled in it. */
export async function courseForPage(me: Me, courseId: string): Promise<Course> {
  const c = await withUser(me.id, (db) => loadCourse(db, courseId));
  if (!c || !c.my_role) notFound();
  return c;
}

/** For API routes: the course, or 403 if the user is not enrolled. */
export async function requireMember(db: Db, courseId: string): Promise<Course> {
  const c = await loadCourse(db, courseId);
  if (!c || !c.my_role) throw new HttpError(403, 'You are not enrolled in that course.');
  return c;
}

export async function requireProf(db: Db, courseId: string): Promise<Course> {
  const c = await requireMember(db, courseId);
  if (!c.is_prof) throw new HttpError(403, 'Only the professor of this course can do that.');
  return c;
}

export async function myCourses(me: Me): Promise<Course[]> {
  return withUser(me.id, async (db) => {
    const r = await db.query(`${COURSE_SQL} WHERE e.user_id IS NOT NULL ORDER BY c.code`);
    return r.rows as Course[];
  });
}
