import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { report } from '@/lib/features/chat';

type P = { threadId: string };
const Schema = z.object({
  messageId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500),
});

export const POST = route<P>(async (req, { me, params }) => {
  const id = assertUuid(params.threadId);
  const input = await body(req, Schema);
  await withUser(me.id, (db) => report(db, me, id, input));
  return { ok: true };
});
