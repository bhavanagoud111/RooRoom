import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { createEvent, EventInput, listEvents } from '@/lib/features/calendar';

export const GET = route(async (req, { me }) => {
  const sp = req.nextUrl.searchParams;
  const from = new Date(sp.get('from') ?? Date.now() - 7 * 86400000);
  const to = new Date(sp.get('to') ?? Date.now() + 35 * 86400000);
  if (Number.isNaN(+from) || Number.isNaN(+to) || to.getTime() - from.getTime() > 120 * 86400000) {
    throw new HttpError(400, 'Bad date range.');
  }
  return withUser(me.id, async (db) => {
    const events = await listEvents(db, from, to);
    const courses = (await db.query(
      `SELECT c.id, c.code, c.title, my_course_color(c.id, c.color) AS color FROM courses c
         JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid() ORDER BY c.code`)).rows;
    return { events, courses, timezone: me.timezone };
  }, { readOnly: true });
});

const Create = EventInput.extend({ force: z.boolean().optional() });

// Manual entries get the same overlap warning as voice bookings: the first try returns the
// clash, and the student re-sends with force to book anyway.
export const POST = route(async (req, { me }) => {
  const { force, ...input } = await body(req, Create);
  return withUser(me.id, (db) => createEvent(db, me, input, 'manual', force ?? false));
});
