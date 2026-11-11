import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { report } from '@/lib/features/notes';

type P = { noteId: string };
const Schema = z.object({ reason: z.string().trim().min(3).max(500) });

export const POST = route<P>(async (req, { me, params }) => {
  const { reason } = await body(req, Schema);
  await report(me, assertUuid(params.noteId), reason);
  return { ok: true };
});
