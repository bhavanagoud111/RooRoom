import { z } from 'zod';
import { body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { runCalendarAgent } from '@/lib/features/calendar';
import { spend } from '@/lib/limits';

const Schema = z.object({
  text: z.string().trim().min(2).max(600),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1200) })).max(8).optional(),
});

export const POST = route(async (req, { me }) => {
  const { text, history } = await body(req, Schema);
  return withUser(me.id, async (db) => {
    await spend(db, me.id, 'ai');
    return runCalendarAgent(db, me, text, history ?? []);
  });
});
