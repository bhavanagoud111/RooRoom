import Link from 'next/link';
import { ArrowRight, BookOpenCheck, CalendarDays, FileText, Megaphone, Users } from 'lucide-react';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { Badge, DateTile, SectionCard, dueLabel, timeAgo } from '@/components/ui';
import { Translatable } from '@/components/client';
import { courseNav } from './nav';
import { TAGS } from './tags';

export const dynamic = 'force-dynamic';

export default async function CourseHome({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);

  const data = await withUser(me.id, async (db) => {
    // One connection runs one query at a time, so these run in order.
    const q = async (sql: string) => db.query(sql, [courseId]);
    const answers = await q(
        `SELECT id, question_summary, answer_english, published_at FROM clarifications
          WHERE course_id = $1 ORDER BY published_at DESC LIMIT 3`);
    const events = await q(
        `SELECT id, title, starts_at, kind, status FROM events
          WHERE course_id = $1 AND starts_at > now() - interval '1 hour' AND starts_at < now() + interval '21 days'
          ORDER BY starts_at LIMIT 5`);
    const studying = await q(
        `SELECT p.display_name, p.activity_line, p.activity_at FROM profiles p
          JOIN enrollments e ON e.user_id = p.id AND e.course_id = $1
          WHERE p.id <> app_uid() AND p.role = 'student' AND p.activity_course_id = $1
            AND p.activity_at > now() - interval '3 days' AND p.activity_line IS NOT NULL
          ORDER BY p.activity_at DESC LIMIT 4`);
    const docs = await q(
        `SELECT id, title, kind, module, created_at FROM documents
          WHERE course_id = $1 AND visibility = 'class' ORDER BY created_at DESC LIMIT 5`);
    const catalog = await q(
        `SELECT cc.description, cc.prerequisites FROM catalog_courses cc
          JOIN courses c ON c.catalog_code = cc.code WHERE c.id = $1`);
    const links = await q(
        `SELECT
           (SELECT count(*) FROM clarifications WHERE course_id = $1)::int AS answers,
           (SELECT count(*) FROM documents WHERE course_id = $1 AND visibility = 'class')::int AS materials,
           (SELECT coalesce(max((regexp_match(status_note, '(\\d+) dates suggested'))[1]::int), 0) FROM documents
              WHERE course_id = $1 AND kind = 'syllabus' AND visibility = 'class')::int AS syllabus_events,
           (SELECT count(*) FROM events WHERE course_id = $1 AND source = 'syllabus' AND status = 'suggested')::int AS suggested,
           (SELECT count(*) FROM profiles p JOIN enrollments e ON e.user_id = p.id AND e.course_id = $1
              WHERE p.activity_course_id = $1 AND p.activity_at > now() - interval '3 days' AND p.id <> app_uid())::int AS active_buddies,
           (SELECT count(*) FROM clusters WHERE course_id = $1 AND status = 'digest')::int AS open_digests,
           (SELECT coalesce(sum(question_count), 0) FROM clusters WHERE course_id = $1 AND status = 'digest')::int AS waiting,
           (SELECT count(*) FROM anon_notes WHERE course_id = $1 AND status = 'delivered')::int AS notes`);
    return {
      answers: answers.rows, events: events.rows, studying: studying.rows, docs: docs.rows,
      catalog: catalog.rows[0] as { description: string | null; prerequisites: string | null } | undefined, links: links.rows[0],
    };
  });

  const base = `/c/${courseId}`;
  const L = data.links;
  const description = data.catalog?.description ?? c.description;

  // Same sections, order and labels as the course tabs (nav.ts); only the detail line differs.
  const detail: Record<string, { text: string; attention?: boolean }> = {
    [`${base}/dashboard`]: { text: `${L.open_digests} digest${L.open_digests === 1 ? '' : 's'} awaiting an answer`, attention: L.open_digests > 0 },
    [`${base}/inbox`]: { text: `${L.notes} screened note${L.notes === 1 ? '' : 's'} delivered` },
    [`${base}/materials`]: { text: c.is_prof ? `${L.materials} file${L.materials === 1 ? '' : 's'} · ${L.syllabus_events} syllabus dates sent` : `${L.materials} course file${L.materials === 1 ? '' : 's'}` },
    [`${base}/study`]: { text: `Grounded in ${L.materials} file${L.materials === 1 ? '' : 's'} and ${L.answers} clarification${L.answers === 1 ? '' : 's'}` },
    [`${base}/ask`]: { text: 'Anonymous, in any language' },
    [`${base}/notes`]: { text: 'Screened before delivery' },
    [`${base}/buddies`]: { text: `${L.active_buddies} classmate${L.active_buddies === 1 ? '' : 's'} active this week` },
    [`${base}/settings`]: { text: TAGS.settings },
    ['/calendar']: { text: L.suggested ? `${L.suggested} syllabus date${L.suggested === 1 ? '' : 's'} to confirm` : 'Deadlines and study blocks', attention: L.suggested > 0 },
  };
  const tools = courseNav(courseId, c.is_prof).filter((t) => !t.exact)
    .map((t) => ({ ...t, detail: detail[t.href]?.text ?? t.tag, attention: detail[t.href]?.attention }));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {(description || data.catalog?.prerequisites) && (
          <SectionCard title="Course overview" icon={<BookOpenCheck className="h-4 w-4" />}>
            {description && <p className="text-sm leading-relaxed text-ink-soft">{description}</p>}
            {data.catalog?.prerequisites && (
              <p className="mt-3 text-sm text-ink-mute"><span className="font-medium text-ink-soft">Prerequisites:</span> {data.catalog.prerequisites}</p>
            )}
          </SectionCard>
        )}

        <section aria-labelledby="tools">
          <h2 id="tools" className="mb-3 text-center text-base font-semibold text-ink">{c.is_prof ? 'Teaching tools' : 'Study tools'}</h2>
          <nav aria-label="Course sections" className="mx-auto grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-3">
            {tools.map((t) => (
              <Link key={t.href} href={t.href} className="card group flex flex-col items-center px-3 py-4 text-center transition-colors hover:border-roo-300 hover:bg-roo-50/30">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-roo-50 text-roo-600"><t.icon className="h-4 w-4" aria-hidden /></span>
                <span className="mt-2 text-sm font-medium text-ink group-hover:text-roo-700">{t.label}</span>
                <span className={`mt-0.5 text-xs ${t.attention ? 'font-medium text-gold-700' : 'text-ink-mute'}`}>{t.detail}</span>
              </Link>
            ))}
          </nav>
        </section>

        <SectionCard title="Recent clarifications" icon={<Megaphone className="h-4 w-4" />}
          action={<Link href={c.is_prof ? `${base}/dashboard` : `${base}/ask`} className="card-link">View all <ArrowRight className="h-3 w-3" /></Link>}
          bodyClassName="p-0">
          {data.answers.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-mute">
              {c.is_prof ? 'When a question digest reaches you, your answer is published to the whole class here.'
                : 'When enough classmates ask the same thing, the professor answers everyone here.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.answers.map((a) => (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{a.question_summary ?? 'Announcement'}</p>
                    <span className="text-xs text-ink-mute">{c.professor_name ?? 'Professor'} · {timeAgo(a.published_at)}</span>
                  </div>
                  <Translatable className="mt-1.5 text-sm text-ink-soft" text={a.answer_english} kind="answer" lang={me.preferred_language} cache />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <aside className="space-y-6">
        <SectionCard title="Upcoming deadlines" icon={<CalendarDays className="h-4 w-4" />} bodyClassName="p-0"
          action={!c.is_prof ? <Link href="/calendar" className="card-link">Calendar <ArrowRight className="h-3 w-3" /></Link> : undefined}>
          {data.events.length === 0 ? <p className="px-5 py-5 text-sm text-ink-mute">Nothing for this course in the next 3 weeks.</p> : (
            <ul className="divide-y divide-line">
              {data.events.map((e) => {
                const soon = e.kind !== 'study' && new Date(e.starts_at).getTime() - Date.now() < 3 * 86_400_000;
                return (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                    <DateTile iso={e.starts_at} tz={me.timezone} urgent={soon} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{e.title}</p>
                      <p className="mt-0.5 text-xs text-ink-mute">{e.kind} · {dueLabel(e.starts_at)}</p>
                      {e.status === 'suggested' && <Badge tone="blue" className="mt-1">From syllabus · confirm</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Course materials" icon={<FileText className="h-4 w-4" />} bodyClassName="p-0"
          action={<Link href={`${base}/materials`} className="card-link">All <ArrowRight className="h-3 w-3" /></Link>}>
          {data.docs.length === 0 ? <p className="px-5 py-5 text-sm text-ink-mute">No class materials yet.</p> : (
            <ul className="divide-y divide-line">
              {data.docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{d.title}</span>
                    {d.module && <span className="block text-xs text-ink-mute">{d.module}</span>}
                  </span>
                  <Badge tone={d.kind === 'syllabus' ? 'blue' : 'gray'}>{d.kind}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {!c.is_prof && (
          <SectionCard title="Class collaboration" icon={<Users className="h-4 w-4" />} bodyClassName="p-0"
            action={<Link href={`${base}/buddies`} className="card-link">Study buddies <ArrowRight className="h-3 w-3" /></Link>}>
            {data.studying.length === 0 ? <p className="px-5 py-5 text-sm text-ink-mute">No visible classmates have studied this course in the last 3 days.</p> : (
              <ul className="divide-y divide-line">
                {data.studying.map((s, i) => (
                  <li key={i} className="px-5 py-2.5 text-sm">
                    <span className="font-medium text-ink">{s.display_name}</span>
                    <span className="block text-xs text-ink-mute">{s.activity_line} · {timeAgo(s.activity_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </aside>
    </div>
  );
}
