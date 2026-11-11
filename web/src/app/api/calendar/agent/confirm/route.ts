import { z } from 'zod';
import { body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { executePending, PendingSchema } from '@/lib/features/calendar';

const Schema = z.object({ actions: PendingSchema });

// Runs the deletes and overlapping bookings the student explicitly confirmed. Each action is
// re-validated and runs as the student under Row Level Security, so only their own events change.
export const POST = route(async (req, { me }) => {
  const { actions } = await body(req, Schema);
  return { results: await withUser(me.id, (db) => executePending(db, me, actions)) };
});
