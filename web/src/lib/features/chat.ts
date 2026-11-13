import 'server-only';
import { HttpError, type Me } from '../auth';
import { open, seal } from '../crypto';
import type { Db } from '../db';
import { audit, spend } from '../limits';

// Study buddies and chat. Every query runs as the signed-in student under Row Level Security:
// the buddy list only contains classmates who opted in, threads and messages only exist for
// their members, and message bodies are encrypted with a key the database never sees.

// ------------------------------------------------------------------ time zone helpers
/** Offset (minutes) of `tz` from UTC at instant `d`. */
function tzOffset(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - d.getTime()) / 60000;
}

/** The UTC instant of a wall-clock time in `tz`. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const off = tzOffset(guess, tz);
  const first = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffset(first, tz);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}

/** Today's calendar date (y, m, d) in `tz`. */
export function localYmd(d: Date, tz: string): [number, number, number] {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, dd] = s.split('-').map(Number);
  return [y, m, dd];
}

function safeTz(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'America/Chicago';
  }
}

type Interval = { s: number; e: number };
export type FreeSlot = { start: string; end: string; label: string };

/** Shared free time over the next 7 days, 8:00 to 22:00 in the viewer's time zone. */
export function sharedFree(mine: Interval[], theirs: Interval[], tzIn: string, now = new Date()): FreeSlot[] {
  const tz = safeTz(tzIn);
  const busy = [...mine, ...theirs];
  const SLOT = 30 * 60000;
  const out: FreeSlot[] = [];
  const [y, m, d] = localYmd(now, tz);
  for (let day = 0; day < 7; day++) {
    const base = new Date(Date.UTC(y, m - 1, d + day));
    const [yy, mm, dd] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
    let runStart: number | null = null;
    let runEnd = 0;
    const flush = () => {
      if (runStart !== null && runEnd - runStart >= 60 * 60000) {
        out.push({ start: new Date(runStart).toISOString(), end: new Date(runEnd).toISOString(), label: label(runStart, runEnd, tz) });
      }
      runStart = null;
    };
    for (let h = 8 * 60; h < 22 * 60; h += 30) {
      const s = zonedToUtc(yy, mm, dd, Math.floor(h / 60), h % 60, tz).getTime();
      const e = s + SLOT;
      const free = e > now.getTime() && !busy.some((b) => b.s < e && b.e > s);
      if (free) {
        if (runStart === null) runStart = Math.max(s, roundUp(now.getTime()));
        runEnd = e;
      } else flush();
    }
    flush();
  }
  return out;
}

function roundUp(t: number) {
  const q = 30 * 60000;
  return Math.ceil(t / q) * q;
}

function label(s: number, e: number, tz: string) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(s));
  const t = (x: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
      .format(new Date(x)).replace(':00', '').replace(' ', '').toLowerCase();
  return `${day} ${t(s)}–${t(e)}`;
}

// ------------------------------------------------------------------ buddies
export type Buddy = {
  id: string;
  display_name: string;
  activity_line: string | null;
  activity_at: string | null;
  free: FreeSlot[];
  thread_id: string | null;
  blocked: boolean;
};

export async function listBuddies(db: Db, me: Me, courseId: string): Promise<Buddy[]> {
  const r = await db.query(
    `SELECT p.id, p.display_name,
            CASE WHEN p.activity_course_id = $1 AND p.activity_at > now() - interval '7 days' THEN p.activity_line END AS activity_line,
            CASE WHEN p.activity_course_id = $1 THEN p.activity_at END AS activity_at,
            (SELECT t.id FROM threads t
               JOIN thread_members a ON a.thread_id = t.id AND a.user_id = app_uid()
               JOIN thread_members b ON b.thread_id = t.id AND b.user_id = p.id
              WHERE t.course_id = $1 AND NOT t.is_group LIMIT 1) AS thread_id,
            EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker_id = app_uid() AND bl.blocked_id = p.id) AS blocked
       FROM enrollments e JOIN profiles p ON p.id = e.user_id
      WHERE e.course_id = $1 AND e.role_in_course = 'student' AND p.role = 'student'
        AND p.visible_to_classmates AND p.id <> app_uid()
      ORDER BY (p.activity_course_id = $1 AND p.activity_at > now() - interval '7 days') DESC NULLS LAST,
               p.activity_at DESC NULLS LAST, p.display_name`,
    [courseId]);

  const from = new Date();
  const to = new Date(from.getTime() + 8 * 86400000);
  const mineR = await db.query(
    `SELECT starts_at, ends_at FROM events WHERE user_id = app_uid() AND status = 'confirmed'
        AND ends_at > $1 AND starts_at < $2`, [from, to]);
  const mine = mineR.rows.map((x) => ({ s: new Date(x.starts_at).getTime(), e: new Date(x.ends_at).getTime() }));

  const out: Buddy[] = [];
  for (const row of r.rows) {
    const b = await db.query('SELECT * FROM buddy_busy($1, $2, $3, $4)', [courseId, row.id, from, to]);
    const theirs = b.rows.map((x) => ({ s: new Date(x.starts_at).getTime(), e: new Date(x.ends_at).getTime() }));
    out.push({ ...row, free: row.blocked ? [] : sharedFree(mine, theirs, me.timezone, from).slice(0, 4) });
  }
  return out;
}

// ------------------------------------------------------------------ threads
export type ThreadSummary = {
  id: string;
  is_group: boolean;
  title: string | null;
  members: { id: string; display_name: string }[];
  last_at: string | null;
};

export async function listThreads(db: Db, courseId: string): Promise<ThreadSummary[]> {
  const r = await db.query(
    `SELECT t.id, t.is_group, t.title,
            (SELECT max(created_at) FROM messages m WHERE m.thread_id = t.id) AS last_at,
            coalesce((SELECT json_agg(json_build_object('id', p.id, 'display_name', p.display_name) ORDER BY p.display_name)
                        FROM thread_members tm JOIN profiles p ON p.id = tm.user_id
                       WHERE tm.thread_id = t.id AND tm.user_id <> app_uid()), '[]') AS members
       FROM threads t WHERE t.course_id = $1
      ORDER BY last_at DESC NULLS LAST, t.created_at DESC`, [courseId]);
  return r.rows;
}

export type ChatAttachment = { id: string; filename: string; content_type: string; size_bytes: number };
export type ChatMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  mine: boolean;
  body: string;
  created_at: string;
  attachments: ChatAttachment[];
};

export async function threadMeta(db: Db, threadId: string) {
  const r = await db.query(
    `SELECT t.id, t.course_id, t.is_group, t.title,
            coalesce((SELECT json_agg(json_build_object('id', p.id, 'display_name', p.display_name,
                       'blocked', EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = app_uid() AND b.blocked_id = p.id))
                       ORDER BY p.display_name)
                        FROM thread_members tm JOIN profiles p ON p.id = tm.user_id
                       WHERE tm.thread_id = t.id AND tm.user_id <> app_uid()), '[]') AS members,
            is_blocked_in_thread(t.id) AS blocked
       FROM threads t WHERE t.id = $1`, [threadId]);
  if (!r.rows[0]) throw new HttpError(404, 'That conversation does not exist, or you are not in it.');
  return r.rows[0] as {
    id: string; course_id: string; is_group: boolean; title: string | null; blocked: boolean;
    members: { id: string; display_name: string; blocked: boolean }[];
  };
}

export async function getMessages(db: Db, threadId: string, after?: string | null): Promise<ChatMessage[]> {
  const r = await db.query(
    `SELECT m.id, m.sender_id, m.body, m.created_at, coalesce(p.display_name, 'Classmate') AS sender_name,
            (m.sender_id = app_uid()) AS mine,
            coalesce((SELECT json_agg(json_build_object('id', a.id, 'filename', a.filename, 'content_type', a.content_type,
                                                        'size_bytes', a.size_bytes) ORDER BY a.created_at)
                        FROM message_attachments a WHERE a.message_id = m.id), '[]'::json) AS attachments
       FROM messages m LEFT JOIN profiles p ON p.id = m.sender_id
      WHERE m.thread_id = $1 AND ($2::timestamptz IS NULL OR m.created_at > $2::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = m.id AND h.user_id = app_uid())
      ORDER BY m.created_at DESC LIMIT 200`, [threadId, after ?? null]);
  return r.rows.reverse().map((m) => ({ ...m, body: open(m.body) }));
}

export async function sendMessage(db: Db, me: Me, threadId: string, text: string): Promise<ChatMessage> {
  const meta = await threadMeta(db, threadId);
  if (meta.blocked) throw new HttpError(403, 'You can’t send messages in this conversation because one of you has blocked the other.');
  await spend(db, me.id, 'message', meta.course_id);
  const r = await db.query(
    `INSERT INTO messages (thread_id, sender_id, author_role, body) VALUES ($1, $2, 'student', $3)
     RETURNING id, created_at`, [threadId, me.id, seal(text)]);
  return { id: r.rows[0].id, sender_id: me.id, sender_name: me.display_name, mine: true, body: text, created_at: r.rows[0].created_at, attachments: [] };
}

/**
 * A message carrying one file (and an optional caption). The caller has already checked the file
 * and stored it, encrypted, at storageKey; both rows are written in the caller's transaction.
 */
export async function sendAttachment(db: Db, me: Me, threadId: string, caption: string,
  file: { id: string; filename: string; contentType: string; size: number; storageKey: string }): Promise<ChatMessage> {
  const meta = await threadMeta(db, threadId);
  if (meta.blocked) throw new HttpError(403, 'You can’t send messages in this conversation because one of you has blocked the other.');
  await spend(db, me.id, 'message', meta.course_id);
  await spend(db, me.id, 'upload', meta.course_id);
  const r = await db.query(
    `INSERT INTO messages (thread_id, sender_id, author_role, body) VALUES ($1, $2, 'student', $3)
     RETURNING id, created_at`, [threadId, me.id, seal(caption)]);
  await db.query(
    `INSERT INTO message_attachments (id, message_id, thread_id, uploader_id, filename, content_type, size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [file.id, r.rows[0].id, threadId, me.id, file.filename, file.contentType, file.size, file.storageKey]);
  await audit(db, me.id, 'chat_file_shared', { thread_id: threadId, attachment_id: file.id, type: file.contentType, bytes: file.size });
  return {
    id: r.rows[0].id, sender_id: me.id, sender_name: me.display_name, mine: true, body: caption, created_at: r.rows[0].created_at,
    attachments: [{ id: file.id, filename: file.filename, content_type: file.contentType, size_bytes: file.size }],
  };
}

/** "Delete for me": hides one message from the signed-in person's view. Others still see it. */
export async function hideMessage(db: Db, threadId: string, messageId: string) {
  await threadMeta(db, threadId);
  const m = await db.query('SELECT 1 FROM messages WHERE id = $1 AND thread_id = $2', [messageId, threadId]);
  if (!m.rows[0]) throw new HttpError(404, 'Message not found.');
  await db.query(
    `INSERT INTO message_hides (user_id, message_id) VALUES (app_uid(), $1) ON CONFLICT DO NOTHING`, [messageId]);
}

export async function block(db: Db, me: Me, userId: string) {
  await db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, userId]);
  await audit(db, me.id, 'blocked_user', { blocked_id: userId });
}

export async function unblock(db: Db, me: Me, userId: string) {
  await db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [me.id, userId]);
  await audit(db, me.id, 'unblocked_user', { blocked_id: userId });
}

/** Reports are logged with the message and both user ids for review. */
export async function report(db: Db, me: Me, threadId: string, input: { messageId?: string; userId?: string; reason: string }) {
  const meta = await threadMeta(db, threadId);
  let reported = input.userId ?? null;
  if (input.messageId) {
    const m = await db.query('SELECT sender_id FROM messages WHERE id = $1 AND thread_id = $2', [input.messageId, threadId]);
    if (!m.rows[0]) throw new HttpError(404, 'Message not found.');
    reported = m.rows[0].sender_id;
  }
  if (reported && !meta.members.some((x) => x.id === reported)) throw new HttpError(400, 'You can only report someone in this conversation.');
  if (!reported && !meta.is_group) reported = meta.members[0]?.id ?? null;
  await db.query(
    `INSERT INTO reports (reporter_id, reported_user_id, message_id, course_id, reason) VALUES ($1, $2, $3, $4, $5)`,
    [me.id, reported, input.messageId ?? null, meta.course_id, input.reason]);
  await audit(db, me.id, 'reported', { thread_id: threadId, message_id: input.messageId ?? null });
}
