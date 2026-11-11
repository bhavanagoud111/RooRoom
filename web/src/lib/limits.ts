import 'server-only';
import { config } from './config';
import type { Db } from './db';
import { HttpError } from './auth';

// Rate limits and read-volume alerts. One stuck loop cannot drain the model credits, and an
// account that suddenly reads across many courses raises an alert, because in the Canvas breach
// the data left through ordinary API calls that only their volume could reveal.

type Kind = 'ai' | 'question' | 'message' | 'note' | 'read' | 'upload';

const WINDOWS: Record<Kind, { max: () => number; interval: string; label: string }> = {
  ai: { max: () => config().limits.ai_calls_per_user_per_day, interval: '1 day', label: 'AI requests today' },
  question: { max: () => config().limits.questions_per_user_per_day, interval: '1 day', label: 'questions today' },
  message: { max: () => config().limits.messages_per_user_per_hour, interval: '1 hour', label: 'messages this hour' },
  note: { max: () => 10, interval: '1 day', label: 'notes today' },
  read: { max: () => config().limits.reads_per_user_per_hour, interval: '1 hour', label: 'reads this hour' },
  upload: { max: () => 40, interval: '1 day', label: 'uploads today' },
};

export async function spend(db: Db, uid: string, kind: Kind, courseId: string | null = null, n = 1) {
  const w = WINDOWS[kind];
  const r = await db.query(
    `SELECT count(*)::int AS c FROM usage_events WHERE user_id = $1 AND kind = $2
       AND created_at > now() - $3::interval`, [uid, kind, w.interval]);
  if (r.rows[0].c + n > w.max()) {
    await audit(db, uid, 'rate_limited', { kind });
    throw new HttpError(429, `You have reached the limit of ${w.max()} ${w.label}. Please try again later.`);
  }
  for (let i = 0; i < n; i++) {
    await db.query('INSERT INTO usage_events (user_id, kind, course_id) VALUES ($1, $2, $3)', [uid, kind, courseId]);
  }
}

/** Counts a read and raises an alert when one account reads across many courses in an hour. */
export async function countRead(db: Db, uid: string, courseId: string, what: string) {
  await spend(db, uid, 'read', courseId);
  const r = await db.query(
    `SELECT count(DISTINCT course_id)::int AS c FROM usage_events
      WHERE user_id = $1 AND kind = 'read' AND created_at > now() - interval '1 hour'`, [uid]);
  const threshold = config().limits.cross_course_alert_threshold;
  if (r.rows[0].c === threshold) {
    await db.query('SELECT raise_alert($1, $2)', ['cross_course_reads',
      JSON.stringify({ courses_in_last_hour: r.rows[0].c, last: what })]);
  }
}

export async function audit(db: Db, uid: string, action: string, detail: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)',
    [uid, action, JSON.stringify(detail)]);
}
