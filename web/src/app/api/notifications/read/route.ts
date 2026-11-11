import { z } from 'zod';
import { body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { markRead } from '@/lib/features/notifications';

const Schema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
]);

export const POST = route(async (req, { me }) => {
  const b = await body(req, Schema);
  await withUser(me.id, (db) => markRead(db, 'all' in b ? 'all' : b.ids));
  return { ok: true };
});
