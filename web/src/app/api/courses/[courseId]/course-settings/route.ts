import { z } from 'zod';
import { assertUuid, body, route } from '@/lib/api';
import { requireProf } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

type P = { courseId: string };
const Schema = z.object({
  clusterThreshold: z.number().int().min(2).max(20).optional(),
  similarityCutoff: z.number().min(0.6).max(0.95).optional(),
  notesEnabled: z.boolean().optional(),
  notesWeeklyLimit: z.number().int().min(1).max(10).optional(),
  muteWeek: z.boolean().optional(),
});

// RLS lets only the course's professor update these columns.
export const PATCH = route<P>(async (req, { me, params }) => {
  const courseId = assertUuid(params.courseId);
  const b = await body(req, Schema);
  await withUser(me.id, async (db) => {
    await requireProf(db, courseId);
    await db.query(
      `UPDATE courses SET
         cluster_threshold  = coalesce($2, cluster_threshold),
         similarity_cutoff  = coalesce($3, similarity_cutoff),
         notes_enabled      = coalesce($4, notes_enabled),
         notes_weekly_limit = coalesce($5, notes_weekly_limit),
         notes_muted_until  = CASE WHEN $6::boolean IS NULL THEN notes_muted_until
                                   WHEN $6 THEN now() + interval '7 days' ELSE NULL END
       WHERE id = $1`,
      [courseId, b.clusterThreshold ?? null, b.similarityCutoff ?? null, b.notesEnabled ?? null,
       b.notesWeeklyLimit ?? null, b.muteWeek ?? null]);
    await audit(db, me.id, 'course_settings_changed', { course_id: courseId, ...b });
  });
  return { ok: true };
});
