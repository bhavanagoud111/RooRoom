import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

type P = { courseId: string };

// Enrolment is self-declared for the hackathon (roster verification is future work).
// Row Level Security only lets a student enrol themselves, and only as a student.
export const POST = route<P>(async (_req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  if (me.role !== 'student') throw new HttpError(403, 'Professors are assigned to courses by the university.');
  const switched = await withUser(me.id, async (db) => {
    // One room per course: picking a different professor for the same catalogue course moves you.
    const left = await db.query(
      `DELETE FROM enrollments e USING courses mine, courses target
        WHERE e.user_id = $1 AND e.role_in_course = 'student' AND e.course_id = mine.id
          AND target.id = $2 AND mine.id <> target.id
          AND mine.catalog_code IS NOT NULL AND mine.catalog_code = target.catalog_code AND mine.term = target.term
        RETURNING mine.id`, [me.id, courseId]);
    await db.query(
      `INSERT INTO enrollments (user_id, course_id, role_in_course) VALUES ($1, $2, 'student')
       ON CONFLICT DO NOTHING`, [me.id, courseId]);
    await audit(db, me.id, 'enrolled', { course_id: courseId, switched_from: left.rowCount ? 'another professor' : undefined });
    return (left.rowCount ?? 0) > 0;
  });
  return { ok: true, switched };
});

export const DELETE = route<P>(async (_req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  await withUser(me.id, (db) =>
    db.query(`DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2 AND role_in_course = 'student'`, [me.id, courseId]));
  return { ok: true };
});
