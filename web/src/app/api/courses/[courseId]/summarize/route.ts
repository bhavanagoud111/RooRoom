import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { summarizeMessages } from '@/lib/features/summarize';

type P = { courseId: string };
const Schema = z.object({ kind: z.enum(['questions', 'feedback']) });

// Professor only (checked inside): the Summarize agent over all anonymous questions or feedback.
export const POST = route<P>(async (req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  const { kind } = await body(req, Schema);
  return summarizeMessages(me, courseId, kind);
});
