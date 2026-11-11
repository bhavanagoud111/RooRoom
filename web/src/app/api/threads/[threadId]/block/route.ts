import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { block, threadMeta, unblock } from '@/lib/features/chat';

type P = { threadId: string };
const Schema = z.object({ userId: z.string().uuid(), unblock: z.boolean().optional() });

export const POST = route<P>(async (req, { me, params }) => {
  const id = assertUuid(params.threadId);
  const { userId, unblock: undo } = await body(req, Schema);
  return withUser(me.id, async (db) => {
    const meta = await threadMeta(db, id);
    if (!meta.members.some((m) => m.id === userId)) throw new HttpError(400, 'That person is not in this conversation.');
    if (undo) await unblock(db, me, userId);
    else await block(db, me, userId);
    return { ok: true };
  });
});
