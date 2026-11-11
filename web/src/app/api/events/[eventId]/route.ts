import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { deleteEvent, EventPatch, updateEvent } from '@/lib/features/calendar';

type P = { eventId: string };
const Patch = EventPatch.extend({ force: z.boolean().optional() });

export const PATCH = route<P>(async (req, { me, params }) => {
  const id = assertUuid(params.eventId);
  const { force, ...patch } = await body(req, Patch);
  return withUser(me.id, (db) => updateEvent(db, me, id, patch, force ?? false));
});

export const DELETE = route<P>(async (_req, { me, params }) => {
  const id = assertUuid(params.eventId);
  await withUser(me.id, (db) => deleteEvent(db, me, id));
  return { ok: true };
});
