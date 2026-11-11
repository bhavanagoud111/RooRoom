import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { reply } from '@/lib/features/notes';

type P = { noteId: string };
const Schema = z.object({ text: z.string().trim().min(1).max(2000) });

// The reply goes back to the student's anonymous thread. The professor never learns who it is.
export const POST = route<P>(async (req, { me, params }) => {
  const { text } = await body(req, Schema);
  await reply(me, assertUuid(params.noteId), text);
  return { ok: true };
});
