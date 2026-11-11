import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { today } from '@/lib/features/calendar';

// "What's for today": built from the events table without a model call, read aloud in the browser.
export const GET = route(async (_req, { me }) => withUser(me.id, (db) => today(db, me), { readOnly: true }));
