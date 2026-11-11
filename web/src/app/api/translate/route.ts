import { z } from 'zod';
import { body, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { spend } from '@/lib/limits';
import { translate } from '@/lib/translate';
import { LANGUAGES } from '@/lib/languages';
import type { Source } from '@/lib/untrusted';

const Schema = z.object({
  text: z.string().min(1).max(6000),
  kind: z.enum(['question', 'answer', 'message', 'note', 'study', 'flashcard']),
  target: z.string().refine((c) => LANGUAGES.some((l) => l.code === c), 'unknown language'),
});

const SOURCE: Record<string, Source> = {
  question: 'student_question', answer: 'professor_answer', message: 'student_message',
  note: 'student_note', study: 'course_document', flashcard: 'course_document',
};

export const POST = route(async (req, { me }) => {
  const { text, kind, target } = await body(req, Schema);
  await withUser(me.id, (db) => spend(db, me.id, 'ai'));
  // Only class-wide professor answers are cached. Private chat and notes never touch the cache.
  const out = await translate(text, target, { cache: kind === 'answer', source: SOURCE[kind] });
  return { text: out };
});
