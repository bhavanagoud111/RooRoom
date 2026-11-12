import { assertUuid, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { seal } from '@/lib/crypto';
import { withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

type P = { threadId: string };

// Leave a group chat. The others see "left the group" as your last message; an empty group is deleted.
export const POST = route<P>(async (_req, { me, params }) => {
  const threadId = assertUuid(params.threadId);
  return withUser(me.id, async (db) => {
    const t = await db.query('SELECT is_group FROM threads WHERE id = $1', [threadId]);
    if (!t.rows[0]) throw new HttpError(404, 'That conversation does not exist, or you are not in it.');
    if (!t.rows[0].is_group) throw new HttpError(400, 'Only group chats can be left. You can block someone instead.');
    await db.query(`INSERT INTO messages (thread_id, sender_id, author_role, body) VALUES ($1, $2, 'student', $3)`,
      [threadId, me.id, seal('👋 left the group')]);
    const r = await db.query('SELECT leave_group($1) AS remaining', [threadId]);
    await audit(db, me.id, 'group_left', { thread_id: threadId });
    return { ok: true, remaining: r.rows[0].remaining as number };
  });
});
