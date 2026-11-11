import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { requireMember } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

const Schema = z.object({
  courseId: z.string().uuid(),
  memberIds: z.array(z.string().uuid()).min(1).max(7),
  title: z.string().trim().max(60).optional(),
});

// create_thread() checks every member is a visible student classmate in this course and that
// nobody has blocked anybody. Professors can never be added: section 8 is the only route to them.
export const POST = route(async (req, { me }) => {
  const { courseId, memberIds, title } = await body(req, Schema);
  if (me.role !== 'student') throw new HttpError(403, 'Chat is for students. Professors are reached through questions and notes.');
  if (!me.visible_to_classmates) throw new HttpError(403, 'Turn on “visible to classmates” in Settings to start a chat.');
  return withUser(me.id, async (db) => {
    await requireMember(db, courseId);
    try {
      const r = await db.query('SELECT create_thread($1, $2::uuid[], $3) AS id', [courseId, [...new Set(memberIds)], title ?? '']);
      await audit(db, me.id, 'thread_opened', { course_id: courseId, members: memberIds.length });
      return { id: r.rows[0].id };
    } catch (e) {
      const msg = (e as Error).message;
      if (/blocked/.test(msg)) throw new HttpError(403, 'You can’t start a chat with someone in a block.');
      if (/visible classmate/.test(msg)) throw new HttpError(403, 'Everyone in a chat must be a classmate who is visible to classmates.');
      if (/members/.test(msg)) throw new HttpError(400, 'A chat has 1 to 7 other people.');
      throw e;
    }
  });
});
