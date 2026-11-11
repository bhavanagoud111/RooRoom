import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { ics } from '@/lib/features/calendar';
import { audit } from '@/lib/limits';

// .ics export of the student's own confirmed events (Google Calendar sync is future work).
export const GET = route(async (_req, { me }) => {
  const text = await withUser(me.id, async (db) => {
    await audit(db, me.id, 'calendar_exported');
    return ics(db);
  });
  return new Response(text, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rooroom.ics"',
      'Cache-Control': 'private, no-store',
    },
  });
});
