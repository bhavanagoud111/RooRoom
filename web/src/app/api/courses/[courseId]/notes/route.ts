import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { submitNote } from '@/lib/features/notes';

type P = { courseId: string };
const Schema = z.object({
  text: z.string().trim().min(5, 'write a little more').max(2000),
  sendAnyway: z.boolean().optional(),
});

export const POST = route<P>(async (req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  const b = await body(req, Schema);
  return submitNote(me, courseId, { text: b.text, sendAnyway: !!b.sendAnyway });
});
