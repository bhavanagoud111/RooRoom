import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

type P = { threadId: string };
const Schema = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(7) });

// Add classmates to a group chat. add_group_members() checks each one is a visible student in the
// same course, not in a block with you, and that the group stays at 8 people or fewer.
export const POST = route<P>(async (req, { me, params }) => {
  const threadId = assertUuid(params.threadId);
  const { memberIds } = await body(req, Schema);
  return withUser(me.id, async (db) => {
    try {
      const r = await db.query('SELECT add_group_members($1, $2::uuid[]) AS n', [threadId, memberIds]);
      await audit(db, me.id, 'group_members_added', { thread_id: threadId, added: r.rows[0].n });
      return { added: r.rows[0].n as number };
    } catch (e) {
      const msg = (e as Error).message;
      if (/not a member/.test(msg)) throw new HttpError(404, 'That conversation does not exist, or you are not in it.');
      if (/only group/.test(msg)) throw new HttpError(400, 'People can only be added to group chats.');
      if (/at most 8/.test(msg)) throw new HttpError(400, 'A group has at most 8 people.');
      if (/visible classmate/.test(msg)) throw new HttpError(403, 'You can only add classmates in this course who are visible to classmates.');
      if (/blocked/.test(msg)) throw new HttpError(403, 'You can’t add someone you have blocked or who has blocked you.');
      throw e;
    }
  });
});
