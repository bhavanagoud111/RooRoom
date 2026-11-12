import Link from 'next/link';
import {
  ArrowRight, BookOpen, CalendarDays, CalendarPlus, FileText, Inbox, Layers, Megaphone, MessageCircleQuestion,
  Search, Sparkles, Users,
} from 'lucide-react';
import { requireMe, type Me } from '@/lib/auth';
import { myCourses, type Course } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { CURRENT_TERM } from '@/lib/config';
import {
  Badge, CourseCard, CourseSwatch, DateTile, Empty, Metric, PageHeader, SectionCard, dueLabel, timeAgo,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

function greeting(tz: string) {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default async function DashboardPage() {
  const me = await requireMe();
  const courses = await myCourses(me);
  return me.role === 'professor' ? <ProfessorDashboard me={me} courses={courses} /> : <StudentDashboard me={me} courses={courses} />;
}

// ------------------------------------------------------------------ student

async function StudentDashboard({ me, courses }: { me: Me; courses: Course[] }) {
  const data = await withUser(me.id, async (db) => {
    const events = await db.query(
      `SELECT ev.id, ev.title, ev.starts_at, ev.kind, ev.status, c.code, my_course_color(c.id, c.color) AS color, c.id AS course_id
         FROM events ev LEFT JOIN courses c ON c.id = ev.course_id
        WHERE ev.user_id = app_uid() AND ev.starts_at > now() - interval '1 hour' AND ev.starts_at < now() + interval '14 days'
          AND ev.kind IN ('deadline','exam','study')
        ORDER BY ev.starts_at LIMIT 8`);
    const activity = await db.query(
      `SELECT * FROM (
         SELECT 'clarification' AS type, k.id, k.question_summary AS title, k.published_at AS at, c.id AS course_id, c.code, my_course_color(c.id, c.color) AS color
           FROM clarifications k JOIN courses c ON c.id = k.course_id
           JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid()
         UNION ALL
         SELECT 'material', d.id, d.title, d.created_at, c.id, c.code, my_course_color(c.id, c.color) AS color
           FROM documents d JOIN courses c ON c.id = d.course_id
           JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid()
          WHERE d.visibility = 'class'
       ) a WHERE at > now() - interval '30 days' ORDER BY at DESC LIMIT 6`);
    const stats = await db.query(
      `SELECT c.id,
              (SELECT count(*) FROM clarifications k WHERE k.course_id = c.id AND k.published_at > now() - interval '7 days')::int AS new_answers,
              (SELECT count(*) FROM events ev WHERE ev.course_id = c.id AND ev.user_id = app_uid()
                  AND ev.kind IN ('deadline','exam') AND ev.starts_at BETWEEN now() AND now() + interval '14 days')::int AS due_soon
         FROM courses c JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid()`);
    const suggested = await db.query(
      `SELECT count(*)::int AS n FROM events WHERE user_id = app_uid() AND status = 'suggested' AND starts_at > now()`);
    return {
      events: events.rows, activity: activity.rows,
      stats: Object.fromEntries(stats.rows.map((x) => [x.id, x])) as Record<string, { new_answers: number; due_soon: number }>,
      suggested: suggested.rows[0].n as number,
    };
  });

  const dueWeek = data.events.filter((e) => e.kind !== 'study' && new Date(e.starts_at).getTime() < Date.now() + 7 * 86_400_000).length;
  const newAnswers = Object.values(data.stats).reduce((n, s) => n + s.new_answers, 0);
  const first = courses[0];

  return (
    <div>
      <PageHeader
        eyebrow={CURRENT_TERM}
        title={`${greeting(me.timezone)}, ${me.display_name.split(' ')[0]}`}
        description={courses.length === 0
          ? 'Join your courses to get started.'
          : `You're enrolled in ${courses.length} course${courses.length === 1 ? '' : 's'}. ${dueWeek} deadline${dueWeek === 1 ? '' : 's'} in the next 7 days, ${newAnswers} new professor clarification${newAnswers === 1 ? '' : 's'} this week.`}
        actions={<Link href="/courses" className="btn-outline"><Search className="h-4 w-4" />Find a course</Link>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Courses" value={courses.length} icon={<BookOpen />} href="/courses" />
        <Metric label="Due in 7 days" value={dueWeek} icon={<CalendarDays />} tone={dueWeek ? 'gold' : 'gray'} href="/calendar" />
        <Metric label="New clarifications" value={newAnswers} icon={<Megaphone />} tone={newAnswers ? 'blue' : 'gray'} />
        <Metric label="Syllabus dates to confirm" value={data.suggested} icon={<CalendarPlus />} tone={data.suggested ? 'gold' : 'gray'} href="/calendar" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="mb-3 flex items-center justify-center gap-2 text-base font-semibold text-ink">
              <Sparkles className="h-4 w-4 text-ink-mute" aria-hidden />Quick actions
            </h2>
            {first ? (
              <nav aria-label="Quick actions" className="mx-auto grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-4">
                <QuickAction href={`/c/${first.id}/study`} icon={<Sparkles className="h-4 w-4" />} label="Open Study AI" sub={first.code} />
                <QuickAction href="/calendar" icon={<CalendarDays className="h-4 w-4" />} label="View calendar" sub="Deadlines and study blocks" />
                <QuickAction href={`/c/${first.id}/buddies`} icon={<Users className="h-4 w-4" />} label="Find study buddies" sub={first.code} />
                <QuickAction href={`/c/${first.id}/ask`} icon={<MessageCircleQuestion className="h-4 w-4" />} label="Ask the professor" sub={`${first.code} · anonymous`} />
              </nav>
            ) : <p className="text-center text-sm text-ink-mute">Join a course to use Study AI, buddies and questions.</p>}
          </section>

          <section aria-labelledby="my-courses">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="my-courses" className="text-base font-semibold text-ink">My courses</h2>
              <Link href="/courses" className="card-link">All courses <ArrowRight className="h-3 w-3" /></Link>
            </div>
            {courses.length === 0 ? (
              <Empty icon={<BookOpen />} title="You haven't joined any courses"
                action={<Link href="/courses" className="btn-primary">Browse the UMKC catalog</Link>}>
                Search the catalog, pick your professor and join the course room.
              </Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {courses.map((c) => {
                  const s = data.stats[c.id];
                  return (
                    <CourseCard key={c.id} c={c}>
                      {s?.due_soon ? <Badge tone="gold">{s.due_soon} due in 2 weeks</Badge> : null}
                      {s?.new_answers ? <Badge tone="blue">{s.new_answers} new clarification{s.new_answers === 1 ? '' : 's'}</Badge> : null}
                      <Badge tone="gray"><Users className="h-3 w-3" />{c.class_size} enrolled</Badge>
                    </CourseCard>
                  );
                })}
              </div>
            )}
          </section>

          <SectionCard title="Recent course activity" icon={<Megaphone className="h-4 w-4" />} bodyClassName="p-0">
            {data.activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-mute">No clarifications or new materials in your courses in the last 30 days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.activity.map((a) => (
                  <li key={a.id}>
                    <Link href={a.type === 'clarification' ? `/c/${a.course_id}/ask` : `/c/${a.course_id}/materials`}
                      className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-ink-mute">
                        {a.type === 'clarification' ? <Megaphone className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink">
                          {a.type === 'clarification' ? 'Professor clarification: ' : 'New material: '}
                          <span className="font-medium">{a.title ?? 'Class-wide answer'}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute">
                          <CourseSwatch color={a.color} />{a.code} · {timeAgo(a.at)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <aside className="space-y-6">
          <SectionCard title="Upcoming" icon={<CalendarDays className="h-4 w-4" />} bodyClassName="p-0"
            action={<Link href="/calendar" className="card-link">Calendar <ArrowRight className="h-3 w-3" /></Link>}>
            {data.events.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-mute">Nothing scheduled in the next two weeks.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.events.map((e) => {
                  const soon = e.kind !== 'study' && new Date(e.starts_at).getTime() - Date.now() < 3 * 86_400_000;
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                      <DateTile iso={e.starts_at} tz={me.timezone} urgent={soon} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{e.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                          {e.code && <><CourseSwatch color={e.color} />{e.code} ·</>}
                          {new Date(e.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: me.timezone })}
                          {' · '}<span className={soon ? 'font-medium text-gold-700' : ''}>{dueLabel(e.starts_at)}</span>
                        </p>
                        <div className="mt-1 flex gap-1">
                          <Badge tone={e.kind === 'exam' ? 'red' : e.kind === 'deadline' ? 'gold' : 'gray'}>{e.kind}</Badge>
                          {e.status === 'suggested' && <Badge tone="blue">from syllabus · confirm</Badge>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

        </aside>
      </div>
    </div>
  );
}

function QuickAction({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link href={href} className="card group flex flex-col items-center px-3 py-4 text-center transition-colors hover:border-roo-300 hover:bg-roo-50/30">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-roo-50 text-roo-600">{icon}</span>
      <span className="mt-2 text-sm font-medium text-ink group-hover:text-roo-700">{label}</span>
      <span className="mt-0.5 w-full truncate text-xs text-ink-mute">{sub}</span>
    </Link>
  );
}

// ------------------------------------------------------------------ professor

async function ProfessorDashboard({ me, courses }: { me: Me; courses: Course[] }) {
  const data = await withUser(me.id, async (db) => {
    // Clusters are visible to the professor only at or above the course's privacy threshold (RLS).
    const stats = await db.query(
      `SELECT c.id,
              (SELECT count(*) FROM clusters cl WHERE cl.course_id = c.id AND cl.status = 'digest')::int AS open_digests,
              (SELECT coalesce(sum(question_count), 0) FROM clusters cl WHERE cl.course_id = c.id AND cl.status = 'digest')::int AS waiting_students,
              (SELECT count(*) FROM anon_notes n WHERE n.course_id = c.id AND n.status = 'delivered'
                  AND n.delivered_at > now() - interval '7 days')::int AS new_notes,
              (SELECT count(*) FROM clarifications k WHERE k.course_id = c.id)::int AS published,
              (SELECT count(*) FROM documents d WHERE d.course_id = c.id AND d.visibility = 'class')::int AS materials
         FROM courses c JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid() AND e.role_in_course = 'professor'`);
    const digests = await db.query(
      `SELECT cl.id, cl.summary, cl.module, cl.question_count, cl.updated_at, c.id AS course_id, c.code, my_course_color(c.id, c.color) AS color
         FROM clusters cl JOIN courses c ON c.id = cl.course_id
        WHERE cl.status = 'digest' AND is_prof(c.id)
        ORDER BY cl.question_count DESC, cl.updated_at DESC LIMIT 6`);
    const published = await db.query(
      `SELECT k.id, k.question_summary, k.published_at, c.id AS course_id, c.code, my_course_color(c.id, c.color) AS color
         FROM clarifications k JOIN courses c ON c.id = k.course_id
        WHERE is_prof(c.id) ORDER BY k.published_at DESC LIMIT 5`);
    return {
      stats: Object.fromEntries(stats.rows.map((x) => [x.id, x])) as Record<string, {
        open_digests: number; waiting_students: number; new_notes: number; published: number; materials: number;
      }>,
      digests: digests.rows, published: published.rows,
    };
  });
  const teaching = courses.filter((c) => c.is_prof);
  const sum = (k: 'open_digests' | 'waiting_students' | 'new_notes' | 'published') =>
    Object.values(data.stats).reduce((n, s) => n + s[k], 0);

  return (
    <div>
      <PageHeader eyebrow={`${CURRENT_TERM} · Faculty`} title={`${greeting(me.timezone)}, ${me.display_name}`}
        description="What your classes need from you" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Courses teaching" value={teaching.length} icon={<BookOpen />} />
        <Metric label="Digests awaiting an answer" value={sum('open_digests')} icon={<Layers />} tone={sum('open_digests') ? 'gold' : 'gray'} />
        <Metric label="Students waiting on those" value={sum('waiting_students')} icon={<Users />} />
        <Metric label="Anonymous notes this week" value={sum('new_notes')} icon={<Inbox />} />
      </div>

      <section className="card mt-6 overflow-hidden" aria-labelledby="teaching">
        <div className="card-header"><h2 id="teaching" className="card-title"><BookOpen className="h-4 w-4 text-ink-mute" />Courses you teach</h2></div>
        {teaching.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-mute">No courses are linked to your account yet. The registrar links professor accounts to their sections.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-mute">
                <tr>
                  <th scope="col" className="px-5 py-2.5">Course</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Students</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Open digests</th>
                  <th scope="col" className="px-3 py-2.5 text-right">New notes</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Published</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Materials</th>
                  <th scope="col" className="px-5 py-2.5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {teaching.map((c) => {
                  const s = data.stats[c.id];
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <CourseSwatch color={c.color} />
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{c.code}</p>
                            <p className="truncate text-xs text-ink-mute">{c.title} · {c.term}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.class_size}</td>
                      <td className="px-3 py-3 text-right">{s?.open_digests ? <Badge tone="gold">{s.open_digests}</Badge> : <span className="tabular-nums text-ink-mute">0</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s?.new_notes ?? 0}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s?.published ?? 0}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s?.materials ?? 0}</td>
                      <td className="px-5 py-3 text-right"><Link href={`/c/${c.id}`} className="btn-outline btn-sm">Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Clarification digests awaiting you" icon={<Layers className="h-4 w-4" />} bodyClassName="p-0">
          {data.digests.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-mute">Nothing waiting. Question groups appear only once enough students have asked, so smaller groups stay private.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.digests.map((d) => (
                <li key={d.id}>
                  <Link href={`/c/${d.course_id}/dashboard`} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="mt-0.5 flex h-8 min-w-8 items-center justify-center rounded-lg bg-gold-50 px-1.5 text-sm font-semibold tabular-nums text-gold-700"
                      aria-label={`${d.question_count} students`}>{d.question_count}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">{d.summary ?? 'Summary being written…'}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute">
                        <CourseSwatch color={d.color} />{d.code}{d.module ? ` · ${d.module}` : ''} · {timeAgo(d.updated_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Recently published clarifications" icon={<Megaphone className="h-4 w-4" />} bodyClassName="p-0">
          {data.published.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-mute">You haven't published a class-wide answer yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.published.map((k) => (
                <li key={k.id} className="px-5 py-3">
                  <p className="text-sm text-ink">{k.question_summary ?? 'Announcement'}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute"><CourseSwatch color={k.color} />{k.code} · {timeAgo(k.published_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
