import 'server-only';
import { z } from 'zod';
import { HttpError, type Me } from '../auth';
import type { Db } from '../db';
import { audit } from '../limits';
import { llm, type ChatMessage, type ToolDef } from '../llm';
import { DATA_RULE, untrusted } from '../untrusted';
import { localYmd, zonedToUtc } from './chat';

// Calendar: manual blocks, the voice agent and syllabus suggestions all write the same events
// table, so "what's for today" sees everything however it was added. Every query here runs as
// the student under Row Level Security; the agent gets no more power than the person using it.

export type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string; kind: 'study' | 'deadline' | 'exam' | 'class';
  source: 'manual' | 'voice' | 'syllabus'; status: 'confirmed' | 'suggested'; weight: string | null;
  course_id: string | null; course_code: string | null; course_title: string | null; color: string | null;
};

const SELECT = `
  SELECT e.id, e.title, e.starts_at, e.ends_at, e.kind, e.source, e.status, e.weight, e.course_id,
         c.code AS course_code, c.title AS course_title, c.color
    FROM events e LEFT JOIN courses c ON c.id = e.course_id`;

export async function listEvents(db: Db, from: Date, to: Date): Promise<EventRow[]> {
  const r = await db.query(`${SELECT} WHERE e.user_id = app_uid() AND e.ends_at >= $1 AND e.starts_at <= $2
                            ORDER BY e.starts_at`, [from, to]);
  return r.rows;
}

export async function getEvent(db: Db, id: string): Promise<EventRow> {
  const r = await db.query(`${SELECT} WHERE e.id = $1`, [id]);
  if (!r.rows[0]) throw new HttpError(404, 'Event not found.');
  return r.rows[0];
}

/** Confirmed time blocks that overlap [start, end). Deadlines are points in time and never clash. */
export async function overlaps(db: Db, start: Date, end: Date, kind: string, excludeId?: string | null) {
  if (kind === 'deadline') return [] as EventRow[];
  const r = await db.query(
    `${SELECT} WHERE e.user_id = app_uid() AND e.status = 'confirmed' AND e.kind <> 'deadline'
       AND e.starts_at < $2 AND e.ends_at > $1 AND ($3::uuid IS NULL OR e.id <> $3::uuid)
     ORDER BY e.starts_at LIMIT 5`, [start, end, excludeId ?? null]);
  return r.rows as EventRow[];
}

export const EventInput = z.object({
  title: z.string().trim().min(1).max(200),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  kind: z.enum(['study', 'deadline', 'exam', 'class']),
  course_id: z.string().uuid().nullable().optional(),
});
export type EventInputT = z.infer<typeof EventInput>;

async function checkCourse(db: Db, courseId: string | null | undefined) {
  if (!courseId) return null;
  const r = await db.query('SELECT is_member($1) AS ok', [courseId]);
  if (!r.rows[0]?.ok) throw new HttpError(403, 'You are not enrolled in that course.');
  return courseId;
}

function normalise(input: EventInputT) {
  const s = new Date(input.starts_at);
  let e = new Date(input.ends_at);
  if (e < s) throw new HttpError(400, 'The end time is before the start time.');
  if (e.getTime() - s.getTime() > 24 * 3600_000) throw new HttpError(400, 'A block can be at most 24 hours long.');
  if (input.kind === 'deadline' && e.getTime() === s.getTime()) e = new Date(s.getTime() + 30 * 60000);
  return { s, e };
}

export async function createEvent(db: Db, me: Me, input: EventInputT, source: 'manual' | 'voice', force = false) {
  const { s, e } = normalise(input);
  const courseId = await checkCourse(db, input.course_id);
  const clash = await overlaps(db, s, e, input.kind);
  if (clash.length && !force) return { created: null, overlaps: clash };
  const r = await db.query(
    `INSERT INTO events (user_id, course_id, title, starts_at, ends_at, kind, source, status, author_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8) RETURNING id`,
    [me.id, courseId, input.title, s, e, input.kind, source, me.role]);
  await audit(db, me.id, 'event_created', { source, event_id: r.rows[0].id });
  return { created: await getEvent(db, r.rows[0].id), overlaps: clash };
}

export const EventPatch = EventInput.partial();

export async function updateEvent(db: Db, me: Me, id: string, patch: z.infer<typeof EventPatch>, force = false) {
  const cur = await getEvent(db, id);
  const merged: EventInputT = {
    title: patch.title ?? cur.title,
    starts_at: patch.starts_at ?? new Date(cur.starts_at).toISOString(),
    ends_at: patch.ends_at ?? new Date(cur.ends_at).toISOString(),
    kind: patch.kind ?? cur.kind,
    course_id: patch.course_id === undefined ? cur.course_id : patch.course_id,
  };
  const { s, e } = normalise(merged);
  const courseId = await checkCourse(db, merged.course_id);
  const clash = await overlaps(db, s, e, merged.kind, id);
  if (clash.length && !force) return { updated: null, overlaps: clash };
  // Editing a suggestion by hand counts as confirming it: a misheard or misread date is a one-click fix.
  await db.query(
    `UPDATE events SET title = $2, starts_at = $3, ends_at = $4, kind = $5, course_id = $6, status = 'confirmed'
      WHERE id = $1`, [id, merged.title, s, e, merged.kind, courseId]);
  await audit(db, me.id, 'event_updated', { event_id: id });
  return { updated: await getEvent(db, id), overlaps: clash };
}

export async function deleteEvent(db: Db, me: Me, id: string) {
  const r = await db.query('DELETE FROM events WHERE id = $1 RETURNING id', [id]);
  if (!r.rows[0]) throw new HttpError(404, 'Event not found.');
  await audit(db, me.id, 'event_deleted', { event_id: id });
}

/** Syllabus suggestions: confirm or dismiss some, or all of one course. */
export async function resolveSuggested(db: Db, me: Me, action: 'confirm' | 'dismiss', ids?: string[], courseId?: string) {
  if (!ids?.length && !courseId) throw new HttpError(400, 'Nothing selected.');
  const where = `user_id = app_uid() AND status = 'suggested' AND (($1::uuid[] IS NOT NULL AND id = ANY($1::uuid[])) OR ($2::uuid IS NOT NULL AND course_id = $2::uuid))`;
  const r = action === 'confirm'
    ? await db.query(`UPDATE events SET status = 'confirmed' WHERE ${where} RETURNING id`, [ids ?? null, courseId ?? null])
    : await db.query(`DELETE FROM events WHERE ${where} RETURNING id`, [ids ?? null, courseId ?? null]);
  await audit(db, me.id, `suggestions_${action}ed`, { count: r.rowCount });
  return r.rowCount ?? 0;
}

// ------------------------------------------------------------------ voice agent
// The transcript goes to a model with exactly four tools. Deletes and overlapping bookings are
// never executed by the model: they come back as pending actions the student confirms.

export type PendingAction =
  | { type: 'create'; input: EventInputT; reason: string; overlaps: { title: string; starts_at: string; ends_at: string }[] }
  | { type: 'update'; id: string; patch: z.infer<typeof EventPatch>; reason: string; title: string; overlaps: { title: string; starts_at: string; ends_at: string }[] }
  | { type: 'delete'; id: string; reason: string; title: string; starts_at: string };

export const PendingSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), input: EventInput }),
  z.object({ type: z.literal('update'), id: z.string().uuid(), patch: EventPatch }),
  z.object({ type: z.literal('delete'), id: z.string().uuid() }),
])).max(10);

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Add a block or deadline to the student’s calendar. Times are LOCAL wall-clock times in the student’s time zone, formatted YYYY-MM-DDTHH:MM (no offset).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title, e.g. "Networks project" or "HW3 due"' },
          start: { type: 'string', description: 'Local start, YYYY-MM-DDTHH:MM' },
          end: { type: 'string', description: 'Local end, YYYY-MM-DDTHH:MM. For a deadline with no time given, use 23:59 on that day and start at 23:00.' },
          kind: { type: 'string', enum: ['study', 'deadline', 'exam', 'class'] },
          course_code: { type: 'string', description: 'One of the student’s course codes, or omit if none fits' },
        },
        required: ['title', 'start', 'end', 'kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_event',
      description: 'Change an existing event. Use list_events first to find its id.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          title: { type: 'string' },
          start: { type: 'string', description: 'Local start, YYYY-MM-DDTHH:MM' },
          end: { type: 'string', description: 'Local end, YYYY-MM-DDTHH:MM' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_event',
      description: 'Delete an event. The student will be asked to confirm before anything is deleted. Use list_events first to find its id.',
      parameters: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'List the student’s events between two local dates (inclusive), YYYY-MM-DD.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
];

function localToUtc(local: string, tz: string): Date {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) throw new Error(`bad time "${local}"`);
  return zonedToUtc(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, tz);
}

function fmtLocal(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(d));
}

export async function runCalendarAgent(db: Db, me: Me, transcript: string, history: { role: 'user' | 'assistant'; content: string }[] = []) {
  const tz = me.timezone;
  const now = new Date();
  const courses = (await db.query(
    `SELECT c.id, c.code, c.title FROM courses c JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid() ORDER BY c.code`,
  )).rows as { id: string; code: string; title: string }[];
  const nowLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(now);
  const [y, mo, d] = localYmd(now, tz);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const system = [
    'You are the calendar assistant inside RooRoom, a student class workspace.',
    `Right now it is ${nowLocal} (${iso}) in the student’s time zone, ${tz}.`,
    'Resolve relative dates ("Friday", "tomorrow", "next Tuesday") from today’s date. "Friday" means the next upcoming Friday. If no duration is given for a study block, use one hour.',
    'One spoken request can contain several actions: call a tool once for each. "Block 9 to 10 for the networks project and add a deadline for HW3 on Friday" is two create_event calls.',
    'To change or delete something, call list_events first to find it. Never guess an event id.',
    'If a tool result says the action is waiting for the student’s confirmation, do not retry it; just mention it.',
    `The student’s courses: ${courses.map((c) => `${c.code} (${c.title})`).join('; ') || 'none'}. Match casual names like "networks" or "stats" to these codes.`,
    'When you are done, reply in one or two short, friendly sentences saying what you did, in the language the student spoke.',
    DATA_RULE,
  ].join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.role === 'user' ? untrusted('transcript', h.content) : h.content }) as ChatMessage),
    { role: 'user', content: untrusted('transcript', transcript) },
  ];

  const done: { action: string; event: EventRow }[] = [];
  const pending: PendingAction[] = [];
  const courseByCode = (code?: string) => {
    if (!code) return null;
    const c = courses.find((x) => x.code.toLowerCase() === code.toLowerCase())
      ?? courses.find((x) => x.code.toLowerCase().replace(/\s+/g, '').includes(code.toLowerCase().replace(/\s+/g, '')));
    return c?.id ?? null;
  };

  async function exec(name: string, args: Record<string, string>): Promise<string> {
    try {
      if (name === 'list_events') {
        const from = localToUtc(args.from, tz);
        const to = new Date(localToUtc(args.to, tz).getTime() + 86400000);
        const evs = await listEvents(db, from, to);
        return JSON.stringify(evs.slice(0, 40).map((e) => ({
          id: e.id, title: e.title, start: fmtLocal(e.starts_at, tz), end: fmtLocal(e.ends_at, tz),
          kind: e.kind, course: e.course_code, status: e.status,
        })));
      }
      if (name === 'create_event') {
        const input = EventInput.parse({
          title: String(args.title ?? 'Study block').slice(0, 200),
          starts_at: localToUtc(args.start, tz).toISOString(),
          ends_at: localToUtc(args.end ?? args.start, tz).toISOString(),
          kind: ['study', 'deadline', 'exam', 'class'].includes(args.kind) ? args.kind : 'study',
          course_id: courseByCode(args.course_code),
        });
        const { s, e } = normalise(input);
        const clash = await overlaps(db, s, e, input.kind);
        if (clash.length) {
          pending.push({ type: 'create', input, reason: `Overlaps ${clash.map((c) => `“${c.title}”`).join(', ')}`,
            overlaps: clash.map((c) => ({ title: c.title, starts_at: c.starts_at, ends_at: c.ends_at })) });
          return 'WAITING_FOR_CONFIRMATION: this overlaps an existing event, so the student will be asked to confirm.';
        }
        const r = await createEvent(db, me, input, 'voice', true);
        done.push({ action: 'created', event: r.created! });
        return `created: ${r.created!.title}, ${fmtLocal(r.created!.starts_at, tz)}`;
      }
      if (name === 'update_event') {
        const ev = await getEvent(db, z.string().uuid().parse(args.event_id));
        const patch: z.infer<typeof EventPatch> = {};
        if (args.title) patch.title = String(args.title).slice(0, 200);
        if (args.start) patch.starts_at = localToUtc(args.start, tz).toISOString();
        if (args.end) patch.ends_at = localToUtc(args.end, tz).toISOString();
        if (patch.starts_at && !patch.ends_at) {
          const dur = new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime();
          patch.ends_at = new Date(new Date(patch.starts_at).getTime() + dur).toISOString();
        }
        const r = await updateEvent(db, me, ev.id, patch, false);
        if (!r.updated) {
          pending.push({ type: 'update', id: ev.id, patch, title: ev.title,
            reason: `Moving it would overlap ${r.overlaps.map((c) => `“${c.title}”`).join(', ')}`,
            overlaps: r.overlaps.map((c) => ({ title: c.title, starts_at: c.starts_at, ends_at: c.ends_at })) });
          return 'WAITING_FOR_CONFIRMATION: the new time overlaps another event, so the student will be asked to confirm.';
        }
        done.push({ action: 'updated', event: r.updated });
        return `updated: ${r.updated.title}, ${fmtLocal(r.updated.starts_at, tz)}`;
      }
      if (name === 'delete_event') {
        const ev = await getEvent(db, z.string().uuid().parse(args.event_id));
        pending.push({ type: 'delete', id: ev.id, title: ev.title, starts_at: ev.starts_at, reason: 'Deleting needs your confirmation' });
        return 'WAITING_FOR_CONFIRMATION: the student will be asked to confirm the delete.';
      }
      return 'unknown tool';
    } catch (e) {
      return `error: ${e instanceof HttpError ? e.message : (e as Error).message}`;
    }
  }

  let reply = '';
  for (let step = 0; step < 6; step++) {
    const r = await llm({ task: 'calendar_agent', messages, tools: TOOLS, temperature: 0, maxTokens: 700 });
    if (!r.toolCalls.length) {
      reply = r.content.trim();
      break;
    }
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
    for (const call of r.toolCalls.slice(0, 8)) {
      let args: Record<string, string> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* empty */ }
      messages.push({ role: 'tool', tool_call_id: call.id, content: await exec(call.function.name, args) });
    }
  }
  if (!reply) reply = done.length ? `Done: ${done.map((x) => x.event.title).join(', ')}.` : 'Sorry, I didn’t catch that. Could you say it again?';
  await audit(db, me.id, 'calendar_agent', { done: done.length, pending: pending.length });
  return { reply, done, pending };
}

export async function executePending(db: Db, me: Me, actions: z.infer<typeof PendingSchema>) {
  const out: { action: string; event?: EventRow; id?: string }[] = [];
  for (const a of actions) {
    if (a.type === 'create') {
      const r = await createEvent(db, me, a.input, 'voice', true);
      out.push({ action: 'created', event: r.created! });
    } else if (a.type === 'update') {
      const r = await updateEvent(db, me, a.id, a.patch, true);
      out.push({ action: 'updated', event: r.updated! });
    } else {
      await deleteEvent(db, me, a.id);
      out.push({ action: 'deleted', id: a.id });
    }
  }
  return out;
}

// ------------------------------------------------------------------ today + .ics
export async function today(db: Db, me: Me) {
  const tz = me.timezone;
  const [y, m, d] = localYmd(new Date(), tz);
  const from = zonedToUtc(y, m, d, 0, 0, tz);
  const to = new Date(from.getTime() + 86400000);
  const evs = (await listEvents(db, from, to)).filter((e) => e.status === 'confirmed');
  const soon = (await listEvents(db, to, new Date(to.getTime() + 6 * 86400000)))
    .filter((e) => e.status === 'confirmed' && (e.kind === 'deadline' || e.kind === 'exam'));
  const t = (x: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(x));
  const name = me.display_name.split(' ')[0];
  const parts: string[] = [];
  parts.push(evs.length === 0 ? `Hi ${name}. Your calendar is clear today.`
    : `Hi ${name}. Today you have ${evs.length} ${evs.length === 1 ? 'thing' : 'things'}.`);
  for (const e of evs) {
    parts.push(e.kind === 'deadline'
      ? `${e.title} is due${e.course_code ? ` for ${e.course_code}` : ''} by ${t(e.ends_at)}.`
      : `${t(e.starts_at)} to ${t(e.ends_at)}: ${e.title}${e.course_code ? `, ${e.course_code}` : ''}.`);
  }
  if (soon.length) {
    const day = (x: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(x));
    parts.push(`Coming up: ${soon.slice(0, 3).map((e) => `${e.title} on ${day(e.starts_at)}`).join('; ')}.`);
  }
  return { events: evs, upcoming: soon, summary: parts.join(' ') };
}

function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function icsDate(d: string | Date) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function ics(db: Db): Promise<string> {
  const r = await db.query(`${SELECT} WHERE e.user_id = app_uid() AND e.status = 'confirmed'
                            AND e.ends_at > now() - interval '60 days' ORDER BY e.starts_at LIMIT 2000`);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RooRoom//Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:RooRoom'];
  const stamp = icsDate(new Date());
  for (const e of r.rows as EventRow[]) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@rooroom`, `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.starts_at)}`, `DTEND:${icsDate(e.ends_at)}`,
      `SUMMARY:${icsEscape((e.course_code ? `[${e.course_code}] ` : '') + e.title)}`,
      `CATEGORIES:${e.kind.toUpperCase()}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/g)!.join('\r\n ') : l)).join('\r\n') + '\r\n';
}
