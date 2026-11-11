import { assertUuid, route } from '@/lib/api';
import { refreshDigest } from '@/lib/features/clarify';

type P = { clusterId: string };

export const POST = route<P>(async (_req, { me, params }) => {
  await refreshDigest(me, assertUuid(params.clusterId));
  return { ok: true };
});
