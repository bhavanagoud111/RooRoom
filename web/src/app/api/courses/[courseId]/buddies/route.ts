import { assertUuid, route } from '@/lib/api';
import { requireMember } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { listBuddies, listThreads } from '@/lib/features/chat';
import { countRead } from '@/lib/limits';

type P = { courseId: string };

export const GET = route<P>(async (_req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  return withUser(me.id, async (db) => {
    const c = await requireMember(db, courseId);
    await countRead(db, me.id, courseId, 'buddies');
    if (c.is_prof) return { isProf: true, visible: false, buddies: [], threads: [] };
    const [buddies, threads] = [await listBuddies(db, me, courseId), await listThreads(db, courseId)];
    return { isProf: false, visible: me.visible_to_classmates, timezone: me.timezone, buddies, threads };
  });
});
