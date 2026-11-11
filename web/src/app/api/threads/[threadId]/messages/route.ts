import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { getMessages, sendMessage, threadMeta } from '@/lib/features/chat';

type P = { threadId: string };

export const GET = route<P>(async (req, { me, params }) => {
  const id = assertUuid(params.threadId);
  const after = req.nextUrl.searchParams.get('after');
  const afterIso = after && !Number.isNaN(Date.parse(after)) ? new Date(after).toISOString() : null;
  return withUser(me.id, async (db) => {
    await threadMeta(db, id);
    return { messages: await getMessages(db, id, afterIso) };
  });
});

const Schema = z.object({ body: z.string().trim().min(1).max(2000) });

export const POST = route<P>(async (req, { me, params }) => {
  const id = assertUuid(params.threadId);
  const { body: text } = await body(req, Schema);
  return withUser(me.id, async (db) => ({ message: await sendMessage(db, me, id, text) }));
});
