import { assertUuid, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { getMessages, threadMeta } from '@/lib/features/chat';
import { countRead } from '@/lib/limits';

type P = { threadId: string };

export const GET = route<P>(async (_req, { me, params }) => {
  const id = assertUuid(params.threadId);
  return withUser(me.id, async (db) => {
    const meta = await threadMeta(db, id);
    await countRead(db, me.id, meta.course_id, 'thread');
    return { thread: meta, messages: await getMessages(db, id) };
  });
});
