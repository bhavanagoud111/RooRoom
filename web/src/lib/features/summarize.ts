import 'server-only';
import { type Me } from '../auth';
import { requireProf } from '../courses';
import { withUser } from '../db';
import { stripOutsideLinks } from '../egress';
import { audit, spend } from '../limits';
import { llm } from '../llm';
import { DATA_RULE, untrusted } from '../untrusted';
import { inbox } from './notes';

// The Summarize agent (professor only). It reads every anonymous question in the course, or
// every delivered feedback note, and tells the professor what comes up most. Inputs are the
// already-redacted texts, passed as quoted data; the agent has no tools.

export type ProfQuestion = { id: string; text: string; module: string | null; status: string; created_at: string };

export async function allQuestions(me: Me, courseId: string): Promise<ProfQuestion[]> {
  return withUser(me.id, async (db) => {
    await requireProf(db, courseId);
    const r = await db.query('SELECT * FROM prof_course_questions($1)', [courseId]);
    return r.rows.map((q) => ({
      id: q.id, text: q.text_redacted, module: q.module, status: q.status, created_at: new Date(q.created_at).toISOString(),
    }));
  });
}

const SYSTEM = (kind: 'questions' | 'feedback') => `You are the Summarize agent for a university professor.
You get anonymous ${kind === 'questions' ? 'questions students asked about the course' : 'feedback notes students sent about the course'}, one per <untrusted> tag. Names were already removed.
Write a short report in markdown:
## Most common
A numbered list of the 3 to 6 most common themes, most frequent first. For each: a bold one-line theme, then "(N students)" with your count of how many items match it, then one sentence on what exactly they are unsure or concerned about.
## Overall
Two or three sentences on the overall picture.
## Suggested next step
One or two concrete things the professor could do (for example "publish a clarification about X").
Never quote anything that could identify a student. Do not invent items. No links or images.
${DATA_RULE}`;

export async function summarizeMessages(me: Me, courseId: string, kind: 'questions' | 'feedback') {
  await withUser(me.id, async (db) => {
    await requireProf(db, courseId);
    await spend(db, me.id, 'ai', courseId);
  });
  const texts = kind === 'questions'
    ? (await allQuestions(me, courseId)).map((q) => (q.module ? `[${q.module}] ` : '') + q.text)
    : (await inbox(me, courseId)).map((n) => n.body);
  if (texts.length === 0) {
    return { summary: kind === 'questions' ? 'No questions yet.' : 'No feedback has been delivered yet.', count: 0 };
  }
  const items = texts.slice(0, 300).map((t, i) => untrusted(kind === 'questions' ? 'student_question' : 'student_note', t.slice(0, 600), { n: i + 1 })).join('\n');
  const r = await llm({
    task: 'cluster_digest', temperature: 0.2, maxTokens: 1500,
    messages: [
      { role: 'system', content: SYSTEM(kind) },
      { role: 'user', content: `${texts.length} ${kind}:\n\n${items}` },
    ],
  });
  const out = stripOutsideLinks(r.content.trim());
  await withUser(me.id, (db) => audit(db, me.id, 'summarize_messages', { course_id: courseId, kind, count: texts.length }));
  return { summary: out.text, count: texts.length };
}
