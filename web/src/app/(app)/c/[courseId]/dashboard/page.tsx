import { notFound } from 'next/navigation';
import { CheckCircle2, Layers, Megaphone } from 'lucide-react';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { Empty, Metric, PageHeader } from '@/components/ui';
import { Announce, DigestCard, type Digest } from './DashboardClient';
import { SummarizeButton } from './Summarize';
import { allQuestions } from '@/lib/features/summarize';
import { Badge } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { When } from '../ask/When';
import { TAGS } from '../tags';

export default async function Dashboard({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  if (!c.is_prof) notFound();

  const data = await withUser(me.id, async (db) => {
    // RLS returns only clusters at or above this course's threshold. The professor has no access
    // to the questions table at all, so individual questions and their authors are unreachable.
    const cl = await db.query(
      `SELECT id, summary, module, question_count, status, created_at, updated_at FROM clusters
        WHERE course_id = $1 ORDER BY (status = 'answered'), question_count DESC, updated_at DESC`, [c.id]);
    const ans = await db.query(
      `SELECT id, cluster_id, question_summary, answer_english, published_at FROM clarifications
        WHERE course_id = $1 ORDER BY published_at DESC LIMIT 20`, [c.id]);
    return { clusters: cl.rows, answers: ans.rows };
  });

  const questions = await allQuestions(me, c.id);
  const open: Digest[] = data.clusters.filter((x) => x.status !== 'answered').map((x) => ({
    id: x.id, summary: x.summary, module: x.module, count: x.question_count, updated_at: new Date(x.updated_at).toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Clarifications" description={TAGS.clarifications} />
      <section aria-labelledby="all-q" className="card overflow-hidden">
        <div className="card-header flex-wrap gap-3">
          <div>
            <h2 id="all-q" className="card-title">All anonymous questions <span className="font-normal text-ink-mute">· {questions.length}</span></h2>
            <p className="mt-0.5 text-xs text-ink-mute">Every question students asked, with names removed. You never see who asked.</p>
          </div>
        </div>
        <div className="border-b border-line p-5"><SummarizeButton courseId={c.id} kind="questions" count={questions.length} /></div>
        {questions.length === 0 ? <p className="px-5 py-6 text-sm text-ink-mute">No questions yet.</p> : (
          <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
            {questions.map((q) => (
              <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
                <p className="min-w-0 flex-1 text-sm text-ink" dir="auto">{q.text}</p>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-mute">
                  {q.module && <Badge tone="gray">{q.module}</Badge>}
                  {q.status === 'answered' && <Badge tone="green">answered</Badge>}
                  <When iso={q.created_at} mode="relative" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric icon={<Layers />} label="Digests awaiting an answer" value={open.length} tone={open.length ? 'gold' : 'gray'} />
        <Metric icon={<Megaphone />} label="Clarifications published" value={data.answers.length} tone="blue" />
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="unsure">
          <h2 id="unsure" className="text-base font-semibold text-ink">What your class is unsure about</h2>
          <p className="mb-4 mt-0.5 text-sm text-ink-mute">
            Similar anonymous questions are grouped. A group becomes a digest once {c.cluster_threshold} or more students have asked;
            one answer goes to the whole class, in each student’s language.
          </p>
          {open.length === 0 ? (
            <Empty icon={<CheckCircle2 />} title="Nothing waiting">
              No group of questions has reached {c.cluster_threshold} students yet. Every question is listed above.
            </Empty>
          ) : (
            <div className="space-y-4">{open.map((d) => <DigestCard key={d.id} d={d} courseId={c.id} />)}</div>
          )}
        </section>
        <aside className="grid content-start gap-4">
          <Announce courseId={c.id} />
        </aside>
      </div>


      {data.answers.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Published clarifications</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data.answers.map((a) => (
              <div key={a.id} className="card p-4">
                <p className="text-xs text-ink-mute"><When iso={new Date(a.published_at).toISOString()} /></p>
                {a.question_summary && <p className="mt-1 text-sm font-semibold text-ink">{a.question_summary}</p>}
                <div className="mt-2 text-sm"><Markdown text={a.answer_english} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
