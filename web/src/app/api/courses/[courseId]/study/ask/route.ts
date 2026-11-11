import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { ask } from '@/lib/features/study';

type P = { courseId: string };

const Schema = z.object({
  question: z.string().trim().min(2).max(1500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(8).default([]),
});

export const POST = route<P>(async (req, { me, params }) => {
  const { question, history } = await body(req, Schema);
  return ask(me, assertUuid(params.courseId), question, history ?? []);
});
