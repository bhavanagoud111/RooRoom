import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessagesSquare, Users } from 'lucide-react';
import { requireMe } from '@/lib/auth';
import { myCourses } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { listThreads, type ThreadSummary } from '@/lib/features/chat';
import { CourseSwatch, Empty, PageHeader, timeAgo } from '@/components/ui';

export const dynamic = 'force-dynamic';

// Every study-buddy conversation across the student's courses, newest first. Each opens the real
// chat inside its course (chats belong to a course, so blocking and reporting stay course-scoped).
export default async function MessagesPage() {
  const me = await requireMe();
  if (me.role !== 'student') redirect('/dashboard');
  const courses = (await myCourses(me)).filter((c) => !c.is_prof);
  const threads = await withUser(me.id, async (db) => {
    const out: (ThreadSummary & { course: (typeof courses)[number] })[] = [];
    for (const c of courses) for (const t of await listThreads(db, c.id)) out.push({ ...t, course: c });
    return out.sort((a, b) => (b.last_at ? Date.parse(b.last_at) : 0) - (a.last_at ? Date.parse(a.last_at) : 0));
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Messages" description="Your study-buddy chats, encrypted" />
      {threads.length === 0 ? (
        <Empty icon={<MessagesSquare />} title="No conversations yet"
          action={courses[0] && <Link href={`/c/${courses[0].id}/buddies`} className="btn-primary"><Users className="h-4 w-4" />Find study buddies</Link>}>
          Start a chat with a classmate from a course's Study Buddies page.
        </Empty>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {threads.map((t) => {
            const name = t.title || t.members.map((m) => m.display_name).join(', ') || 'Conversation';
            return (
              <li key={t.id}>
                <Link href={`/c/${t.course.id}/buddies?thread=${t.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-ink-soft" aria-hidden>
                    {t.is_group ? <Users className="h-4 w-4" /> : name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute">
                      <CourseSwatch color={t.course.color} />{t.course.code}
                      {t.is_group && ` · group of ${t.members.length + 1}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-mute">{t.last_at ? timeAgo(t.last_at) : 'No messages yet'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
