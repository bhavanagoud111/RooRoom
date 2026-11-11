import { Clock, GraduationCap, Info, Users } from 'lucide-react';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { Badge } from '@/components/ui';
import { CourseTabs } from './CourseTabs';

export default async function CourseLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  const sections = await withUser(me.id, async (db) =>
    (await db.query(
      `SELECT section, component, days_times FROM course_sections WHERE course_id = $1 ORDER BY component, section`,
      [c.id])).rows as { section: string; component: string; days_times: string }[]);
  return (
    <div>
      {/* Course context: always visible inside a course */}
      <div className="card mb-5 overflow-hidden">
        <div className="flex">
          <div className="w-1.5 shrink-0" style={{ background: c.color }} aria-hidden />
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-soft">{c.code} <span className="font-normal text-ink-mute">· {c.term}</span></p>
              <h1 className="mt-0.5 text-xl font-semibold text-ink sm:text-2xl">{c.title}</h1>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-mute">
                <div className="flex items-center gap-1.5"><dt className="sr-only">Instructor</dt>
                  <GraduationCap className="h-4 w-4" aria-hidden /><dd>{c.professor_name ?? 'Instructor not announced'}</dd></div>
                <div className="flex items-center gap-1.5"><dt className="sr-only">Enrolment</dt>
                  <Users className="h-4 w-4" aria-hidden /><dd>{c.class_size} enrolled on RooRoom</dd></div>
                {sections.length > 0 && (
                  <div className="flex items-center gap-1.5"><dt className="sr-only">Meets</dt>
                    <Clock className="h-4 w-4" aria-hidden />
                    <dd>{sections.slice(0, 2).map((s) => `${s.component} ${s.section}: ${s.days_times || 'time TBA'}`).join(' · ')}
                      {sections.length > 2 ? ` · +${sections.length - 2} more` : ''}</dd></div>
                )}
              </dl>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.credits && <Badge tone="gray">{c.credits} credits</Badge>}
              {c.is_prof && <Badge tone="blue">You teach this course</Badge>}
              {c.source === 'demo' && <Badge tone="gray">Demo course</Badge>}
            </div>
          </div>
        </div>
        {!c.professor_on_rooroom && !c.is_prof && (
          <p className="flex items-start gap-2 border-t border-gold-100 bg-gold-50 px-5 py-2.5 text-sm text-gold-700" role="note">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {c.professor_name
              ? `${c.professor_name} hasn’t joined RooRoom yet. Questions wait for them; everything else works now.`
              : 'No professor linked yet. Questions wait; everything else works now.'}
          </p>
        )}
      </div>

      <CourseTabs courseId={c.id} isProf={c.is_prof} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
