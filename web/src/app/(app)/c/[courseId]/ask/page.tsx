import { redirect } from 'next/navigation';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { withUser } from '@/lib/db';
import { localise } from '@/lib/features/clarify';
import { PageHeader } from '@/components/ui';
import { AskForm, ClarificationList, MyQuestions } from './AskClient';
import { TAGS } from '../tags';

export default async function AskPage({ params, searchParams }: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { courseId } = await params;
  const { q } = await searchParams;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  if (c.is_prof) redirect(`/c/${c.id}/dashboard`);

  const data = await withUser(me.id, async (db) => {
    const topics = await db.query(
      `SELECT DISTINCT label FROM (
         SELECT module AS label FROM documents WHERE course_id = $1 AND visibility = 'class' AND module IS NOT NULL
         UNION SELECT title FROM documents WHERE course_id = $1 AND visibility = 'class' AND kind IN ('assignment','quiz')
       ) t ORDER BY label`, [c.id]);
    // RLS: a student only ever sees their own questions.
    const mine = await db.query(
      `SELECT q.id, q.text_original, q.status, q.module, q.created_at, k.id AS clarification_id
         FROM questions q LEFT JOIN clarifications k ON k.cluster_id = q.cluster_id
        WHERE q.course_id = $1 ORDER BY q.created_at DESC LIMIT 30`, [c.id]);
    const answers = await db.query(
      `SELECT id, cluster_id, question_summary, answer_english, published_at FROM clarifications
        WHERE course_id = $1 ORDER BY published_at DESC LIMIT 30`, [c.id]);
    return { topics: topics.rows.map((r) => r.label as string), mine: mine.rows, answers: answers.rows };
  });

  // Broadcast: each answer is shown in the student's language (translated once per language and cached).
  const lang = me.preferred_language;
  const localised = await localise(data.answers.flatMap((a) => [a.question_summary, a.answer_english]), lang);

  return (
    <div>
      <PageHeader title="Ask Professor"
        description={TAGS.ask} />
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <AskForm courseId={c.id} topics={data.topics} initial={q ?? ''} threshold={c.cluster_threshold} />
          <MyQuestions questions={data.mine.map((m) => ({ ...m, created_at: new Date(m.created_at).toISOString() }))} />
        </div>
        <section aria-labelledby="published">
          <h2 id="published" className="text-base font-semibold text-ink">Published clarifications</h2>
          <p className="mb-4 mt-0.5 text-sm text-ink-mute">
            Sent to the whole class{lang !== 'en' ? ' and shown in your language' : ''}. The Study AI uses these too, so it never contradicts your professor.
          </p>
          <ClarificationList lang={lang} professor={c.professor_name ?? 'Professor'}
            items={data.answers.map((a, i) => ({
              id: a.id, summary: a.question_summary, answer: a.answer_english,
              summaryLocal: localised[i * 2], answerLocal: localised[i * 2 + 1],
              publishedAt: new Date(a.published_at).toISOString(),
            }))} />
        </section>
      </div>
    </div>
  );
}
