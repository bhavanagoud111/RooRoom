import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { flashcards } from '@/lib/features/study';

type P = { courseId: string };

const Schema = z.object({ documentId: z.string().uuid().optional(), module: z.string().max(60).optional() });

export const POST = route<P>(async (req, { me, params }) => {
  const scope = await body(req, Schema);
  return flashcards(me, assertUuid(params.courseId), scope);
});
