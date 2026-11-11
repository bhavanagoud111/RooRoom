import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { submitQuestion } from '@/lib/features/clarify';

type P = { courseId: string };
const Schema = z.object({
  text: z.string().trim().min(3, 'write a little more').max(1500),
  module: z.string().trim().max(80).nullable().optional(),
  force: z.boolean().optional(),
});

// Submit a question to the professor's question pool. Anonymous to the professor: they only
// ever see clusters of at least `cluster_threshold` students.
export const POST = route<P>(async (req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  const b = await body(req, Schema);
  return submitQuestion(me, courseId, { text: b.text, module: b.module || null, force: !!b.force });
});
