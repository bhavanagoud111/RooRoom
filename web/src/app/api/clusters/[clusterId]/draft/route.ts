import { assertUuid, route } from '@/lib/api';
import { draftAnswer } from '@/lib/features/clarify';

type P = { clusterId: string };

export const POST = route<P>(async (_req, { me, params }) => {
  const draft = await draftAnswer(me, assertUuid(params.clusterId));
  return { draft };
});
