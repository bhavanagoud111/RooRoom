import { z } from 'zod';
import { body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { resolveSuggested } from '@/lib/features/calendar';

const Schema = z.object({
  action: z.enum(['confirm', 'dismiss']),
  ids: z.array(z.string().uuid()).max(200).optional(),
  courseId: z.string().uuid().optional(),
});

// Syllabus dates arrive as suggestions; the student confirms them, because a wrong exam date
// is worse than a missing one.
export const POST = route(async (req, { me }) => {
  const { action, ids, courseId } = await body(req, Schema);
  const n = await withUser(me.id, (db) => resolveSuggested(db, me, action, ids, courseId));
  return { ok: true, count: n };
});
