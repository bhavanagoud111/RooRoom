import { z } from 'zod';
import { assertUuid, body, route, uuid } from '@/lib/api';
import { publish } from '@/lib/features/clarify';

type P = { courseId: string };
const Schema = z.object({
  clusterId: z.string().regex(uuid).nullable().optional(),
  questionId: z.string().regex(uuid).nullable().optional(),
  answer: z.string().trim().min(2).max(4000),
  title: z.string().trim().max(200).nullable().optional(),
});

// Only the professor publishes. The AI can draft, but nothing reaches the class without this call.
export const POST = route<P>(async (req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  const b = await body(req, Schema);
  return publish(me, courseId, { clusterId: b.clusterId ?? null, questionId: b.questionId ?? null, answer: b.answer, title: b.title || null });
});
