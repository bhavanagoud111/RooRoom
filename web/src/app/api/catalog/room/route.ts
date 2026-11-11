import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { CURRENT_TERM } from '@/lib/config';
import { withUser } from '@/lib/db';

const Schema = z.object({ code: z.string().trim().min(3).max(40) });

// A catalogue course that is not on this term's schedule (or has no instructor named yet) can
// still get a room, so a class can start working together before a professor joins.
export const POST = route(async (req, { me }) => {
  const { code } = await body(req, Schema);
  if (me.role !== 'student') throw new HttpError(403, 'Professors are assigned to courses by the university.');
  const id = await withUser(me.id, async (db) => {
    const known = await db.query('SELECT 1 FROM catalog_courses WHERE code = $1', [code]);
    if (!known.rowCount) throw new HttpError(404, 'That course is not in the UMKC catalog.');
    const r = await db.query('SELECT open_catalog_room($1, $2) AS id', [code, CURRENT_TERM]);
    return r.rows[0].id as string;
  });
  return { id };
});
