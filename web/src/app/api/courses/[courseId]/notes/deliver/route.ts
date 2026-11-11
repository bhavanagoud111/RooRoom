import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { requireProf } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { deliverDue } from '@/lib/features/notes';

type P = { courseId: string };

// Demo only: runs today's delivery batch now instead of waiting for 08:00.
export const POST = route<P>(async (_req, { me, params }) => {
  if (process.env.DEV_SHOW_CODES !== 'true') throw new HttpError(404, 'Not found.');
  const courseId = assertUuid(params.courseId);
  await withUser(me.id, (db) => requireProf(db, courseId));
  return { delivered: await deliverDue(courseId, { force: true }) };
});
