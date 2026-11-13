import { assertUuid, route } from '@/lib/api';
import { draftForQuestion } from '@/lib/features/clarify';

type P = { courseId: string; questionId: string };

// Professor only: an AI draft for one anonymous question. Nothing is sent until the professor publishes.
export const POST = route<P>(async (_req, { me, params }) => {
  const draft = await draftForQuestion(me, assertUuid(params.courseId), assertUuid(params.questionId));
  return { draft };
});
