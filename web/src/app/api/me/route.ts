import { z } from 'zod';
import { body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { audit } from '@/lib/limits';
import { LANGUAGES } from '@/lib/languages';

export const GET = route(async (_req, { me }) => ({ me }));

const Schema = z.object({
  displayName: z.string().trim().min(1).max(60),
  preferredLanguage: z.string().refine((c) => LANGUAGES.some((l) => l.code === c), 'unknown language'),
  timezone: z.string().max(64).refine((tz) => {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
  }, 'unknown time zone'),
  visibleToClassmates: z.boolean(),
});

// RLS lets a user update only their own profile, and the column grant excludes role.
export const PATCH = route(async (req, { me }) => {
  const p = await body(req, Schema);
  await withUser(me.id, async (db) => {
    await db.query(
      `UPDATE profiles SET display_name = $2, preferred_language = $3, timezone = $4, visible_to_classmates = $5
        WHERE id = $1`, [me.id, p.displayName, p.preferredLanguage, p.timezone, p.visibleToClassmates]);
    await audit(db, me.id, 'profile_updated', { visible_to_classmates: p.visibleToClassmates, language: p.preferredLanguage });
  });
  return { ok: true };
});
