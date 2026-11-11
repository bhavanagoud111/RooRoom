import { BookOpen, CalendarClock, Inbox, Layers, Users } from 'lucide-react';
import { requireMe } from '@/lib/auth';
import { myCourses } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { CURRENT_TERM } from '@/lib/config';
import { Badge, CourseCard, Empty, PageHeader } from '@/components/ui';
import { CourseSearch } from './CourseSearch';

export default async function CoursesPage() {
  const me = await requireMe();
  const courses = await myCourses(me);
  const stats = await withUser(me.id, async (db) => {
    const r = await db.query(
      `SELECT c.id,
              (SELECT count(*) FROM clarifications k WHERE k.course_id = c.id AND k.published_at > now() - interval '7 days')::int AS new_answers,
              (SELECT count(*) FROM events ev WHERE ev.course_id = c.id AND ev.user_id = app_uid()
                  AND ev.kind IN ('deadline','exam') AND ev.starts_at BETWEEN now() AND now() + interval '14 days')::int AS due_soon,
              (SELECT count(*) FROM clusters cl WHERE cl.course_id = c.id AND cl.status = 'digest')::int AS open_digests,
              (SELECT count(*) FROM anon_notes n WHERE n.course_id = c.id AND n.status = 'delivered'
                  AND n.delivered_at > now() - interval '7 days')::int AS new_notes
         FROM courses c JOIN enrollments e ON e.course_id = c.id AND e.user_id = app_uid()`);
    return Object.fromEntries(r.rows.map((x) => [x.id, x]));
  });

  return (
    <div className="space-y-10">
      <section aria-labelledby="enrolled">
        <PageHeader
          eyebrow={CURRENT_TERM}
          title={me.role === 'professor' ? 'Courses you teach' : 'Courses'}
          description={me.role === 'professor'
            ? 'Each course is a shared room with your students. Open one to see what your class is unsure about.'
            : 'The courses you have joined. Everything inside a course is shared with your class and professor.'}
        />
        <h2 id="enrolled" className="sr-only">Enrolled courses</h2>
        {courses.length === 0 ? (
          <Empty icon={<BookOpen />} title="No courses yet">
            {me.role === 'professor' ? 'Your sections are linked to your account by the registrar.' : 'Search the catalog below, choose your professor and join.'}
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((c) => {
              const s = stats[c.id] ?? {};
              return (
                <CourseCard key={c.id} c={c}>
                  {c.is_prof ? (
                    <>
                      <Badge tone={s.open_digests ? 'gold' : 'gray'}><Layers className="h-3 w-3" />{s.open_digests ?? 0} digests</Badge>
                      <Badge tone="gray"><Users className="h-3 w-3" />{c.class_size} students</Badge>
                      {s.new_notes > 0 && <Badge tone="blue"><Inbox className="h-3 w-3" />{s.new_notes} new notes</Badge>}
                    </>
                  ) : (
                    <>
                      {s.due_soon > 0 && <Badge tone="gold"><CalendarClock className="h-3 w-3" />{s.due_soon} due in 2 weeks</Badge>}
                      {s.new_answers > 0 && <Badge tone="blue">{s.new_answers} new clarifications</Badge>}
                      <Badge tone="gray"><Users className="h-3 w-3" />{c.class_size} enrolled</Badge>
                    </>
                  )}
                </CourseCard>
              );
            })}
          </div>
        )}
      </section>
      {me.role === 'student' && (
        <section aria-labelledby="catalog">
          <div className="mb-4">
            <h2 id="catalog" className="text-lg font-semibold text-ink">Course catalog</h2>
            <p className="mt-0.5 text-sm text-ink-mute">Every UMKC course, with the professors teaching it this term. Choose a professor to join their course room.</p>
          </div>
          <CourseSearch />
        </section>
      )}
    </div>
  );
}
