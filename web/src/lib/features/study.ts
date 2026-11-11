import 'server-only';
import { HttpError, type Me } from '../auth';
import { config } from '../config';
import { requireMember } from '../courses';
import { vec, withUser, type Db } from '../db';
import { stripOutsideLinks } from '../egress';
import { embedOne } from '../embed';
import { languageName } from '../languages';
import { dropEmptyHeadings } from '../markdown';
import { audit, countRead, spend } from '../limits';
import { llm, llmJson, type ChatMessage } from '../llm';
import { DATA_RULE, untrusted } from '../untrusted';

// Feature 1: Study AI.
// Answers come only from the course's own materials plus the professor's published
// clarifications. Retrieval runs as the student (withUser), so Row Level Security decides which
// chunks exist: class documents, the student's own private uploads, and nothing from other courses.

// bge-small expects this instruction in front of search queries (passages are embedded plain).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** Cosine similarity at or above this to an assignment/quiz chunk switches to hints-only mode. */
export const GRADED_SIMILARITY = 0.8;
const CLARIFICATION_BOOST = 0.02; // about one rank position's worth in reciprocal rank fusion
const RRF_K = 60;

export type Source = {
  n: number;
  chunk_id: number;
  document_id: string | null;
  clarification_id: string | null;
  title: string;
  module: string | null;
  kind: string | null;
  page: number | null;
  excerpt: string;
};

type Hit = {
  id: number;
  document_id: string | null;
  clarification_id: string | null;
  doc_kind: string | null;
  page: number | null;
  content: string;
  title: string | null;
  module: string | null;
  question_summary: string | null;
  score: number;
};

/** Hybrid search: pgvector cosine + Postgres full-text, merged with reciprocal rank fusion. */
export async function hybridSearch(db: Db, courseId: string, query: string, qvec: number[], limit: number): Promise<Hit[]> {
  const r = await db.query(
    `WITH v AS (
       SELECT id, row_number() OVER (ORDER BY embedding <=> $2::vector) AS r
         FROM chunks WHERE course_id = $1
        ORDER BY embedding <=> $2::vector LIMIT 40),
     t AS (
       SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) AS r
         FROM chunks, websearch_to_tsquery('english', $3) q
        WHERE course_id = $1 AND tsv @@ q
        ORDER BY ts_rank_cd(tsv, q) DESC LIMIT 40),
     fused AS (
       SELECT coalesce(v.id, t.id) AS id,
              coalesce(1.0 / ($5::float8 + v.r), 0) + coalesce(1.0 / ($5::float8 + t.r), 0) AS score
         FROM v FULL OUTER JOIN t ON v.id = t.id)
     SELECT c.id, c.document_id, c.clarification_id, c.doc_kind, c.page, c.content,
            d.title, d.module, k.question_summary,
            f.score + CASE WHEN c.clarification_id IS NOT NULL THEN $6::float8 ELSE 0 END AS score
       FROM fused f JOIN chunks c ON c.id = f.id
       LEFT JOIN documents d ON d.id = c.document_id
       LEFT JOIN clarifications k ON k.id = c.clarification_id
      ORDER BY score DESC LIMIT $4`,
    [courseId, vec(qvec), query.slice(0, 500), limit, RRF_K, CLARIFICATION_BOOST]);
  return r.rows.map((x) => ({ ...x, score: Number(x.score) }));
}

export type GradedCheck = { hit: boolean; similarity: number; title: string | null; reason: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function shingleOverlap(question: string, chunk: string): number {
  const q = norm(question).split(' ');
  if (q.length < 6) return 0;
  const c = norm(chunk);
  let shared = 0, total = 0;
  for (let i = 0; i + 5 <= q.length; i++) {
    total++;
    if (c.includes(q.slice(i, i + 5).join(' '))) shared++;
  }
  return total ? shared / total : 0;
}

/**
 * Guardrail layer 1, before answering, with no model call: is the request close to a real
 * graded question? Compared by embedding similarity and by word overlap (a pasted question).
 */
export async function gradedCheck(db: Db, courseId: string, question: string, qvec: number[]): Promise<GradedCheck> {
  const r = await db.query(
    `SELECT c.content, d.title, 1 - (c.embedding <=> $2::vector) AS sim
       FROM chunks c LEFT JOIN documents d ON d.id = c.document_id
      WHERE c.course_id = $1 AND c.doc_kind IN ('assignment', 'quiz')
      ORDER BY c.embedding <=> $2::vector LIMIT 5`, [courseId, vec(qvec)]);
  let best: GradedCheck = { hit: false, similarity: 0, title: null, reason: null };
  for (const row of r.rows) {
    const sim = Number(row.sim);
    const overlap = shingleOverlap(question, row.content);
    if (sim > best.similarity) best = { ...best, similarity: sim, title: row.title };
    if (sim >= GRADED_SIMILARITY || overlap >= 0.5) {
      return {
        hit: true, similarity: sim, title: row.title,
        reason: overlap >= 0.5 ? 'Your question repeats wording from graded work' : 'Your question is very close to graded work',
      };
    }
  }
  return best;
}

function toSources(hits: Hit[]): Source[] {
  return hits.map((h, i) => ({
    n: i + 1,
    chunk_id: h.id,
    document_id: h.document_id,
    clarification_id: h.clarification_id,
    title: h.clarification_id ? `Professor clarification${h.question_summary ? `: ${h.question_summary}` : ''}` : (h.title ?? 'Course document'),
    module: h.module,
    kind: h.clarification_id ? 'clarification' : h.doc_kind,
    page: h.page,
    excerpt: h.content.slice(0, 280),
  }));
}

function sourceBlock(hits: Hit[]): string {
  return hits.map((h, i) => h.clarification_id
    ? untrusted('professor_clarification', h.content, { n: i + 1, title: 'Professor clarification' })
    : untrusted('course_document', h.content, { n: i + 1, title: h.title ?? 'document', page: h.page ?? '?', kind: h.doc_kind ?? 'module' }),
  ).join('\n\n');
}

const MATH_RULE = `Write every formula, symbol or equation in LaTeX: $...$ inside a sentence, $$...$$ on its own line for a full equation (for example $$\\hat\\beta_1 = \\frac{\\sum_i (x_i-\\bar x)(y_i-\\bar y)}{\\sum_i (x_i-\\bar x)^2}$$). Never write formulas as plain text such as "(TSS - RSS)/p" or "e1^2". After a formula, say in words what each symbol means.`;

const STUDY_RULES = (lang: string, hintsOnly: boolean) => `You are the Study AI for one university course on RooRoom.
Answer only from the numbered course sources provided. Cite every factual sentence with its source number in square brackets, like [2]. Never cite a number that is not provided.
If the sources do not contain the answer, say so plainly and suggest asking the professor through "Ask the professor". Do not use outside knowledge to fill gaps.
Professor clarifications override any other source; never contradict them.
Write the answer in ${languageName(lang)}, whatever language the question is in (the student can translate it with one click). Keep citations as [n].
Use short paragraphs and markdown lists where helpful. Do not include links or images.
${MATH_RULE}
You help students learn; you never complete graded work for them. Never give the final answer to an assignment, quiz or exam question.
${hintsOnly
    ? 'HINTS-ONLY MODE IS ON: this request is close to a real graded question. Do not solve it, do not give final answers, code, numbers or worked steps. Instead explain the underlying concept with citations, and end with 2-3 guiding questions that help the student work it out.'
    : ''}
${DATA_RULE}`;

const CHECK_SYSTEM = `You check a draft reply from a course study assistant before a student sees it.
Decide whether the draft contains a worked final answer to a graded assignment, quiz or exam question: a final numeric result, completed code, a fully worked solution, or a direct answer the student could submit.
Explaining concepts, definitions and citations from course materials is fine.
Return JSON {"contains_worked_final_answer": boolean, "rewritten": string}.
If true, "rewritten" must keep the explanation and citations [n] but replace the solved part with guiding questions, in the same language as the draft. If false, "rewritten" is an empty string.
${DATA_RULE}`;

export type AskResult = {
  answer: string;
  sources: Source[];
  hintsOnly: boolean;
  guardrail: { layer1: boolean; layer2: boolean; reason: string | null; similarity: number };
  linksRemoved: number;
  lang: string;
};

export type Turn = { role: 'user' | 'assistant'; content: string };

/** Guardrail layer 2: a cheap model reads the draft and rewrites any worked final answer. */
async function guardrailCheck(question: string, draft: string): Promise<{ flagged: boolean; text: string }> {
  const r = await llmJson<{ contains_worked_final_answer?: boolean; rewritten?: string }>(
    'guardrail_check', CHECK_SYSTEM,
    `${untrusted('student_request', question)}\n\n<draft>\n${draft.replace(/</g, '‹').replace(/>/g, '›')}\n</draft>`, 1500);
  if (r.contains_worked_final_answer && r.rewritten && r.rewritten.trim().length > 20) {
    return { flagged: true, text: r.rewritten.trim() };
  }
  return { flagged: false, text: draft };
}

function moduleActivity(hits: Hit[]): string | null {
  const top = hits.find((h) => h.document_id);
  if (!top) return null;
  return `reviewing ${top.module ?? top.title ?? 'course materials'}`.slice(0, 80);
}

async function recordActivity(db: Db, me: Me, courseId: string, line: string | null) {
  if (!line || me.role !== 'student') return;
  await db.query(
    `UPDATE profiles SET activity_course_id = $2, activity_line = $3, activity_at = now() WHERE id = $1`,
    [me.id, courseId, line]);
}

function cleanOutput(text: string, maxN: number) {
  // Drop citation markers that point at sources we did not give the model.
  const t = text.replace(/\[(\d+)\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= maxN ? m : ''));
  return stripOutsideLinks(t);
}

export async function ask(me: Me, courseId: string, question: string, history: Turn[]): Promise<AskResult> {
  const qvec = await embedOne(QUERY_PREFIX + question);
  const topN = config().limits.study_ai_top_chunks;

  const ctx = await withUser(me.id, async (db) => {
    await requireMember(db, courseId);
    await spend(db, me.id, 'ai', courseId, 2);
    await countRead(db, me.id, courseId, 'study_ai');
    const hits = await hybridSearch(db, courseId, question, qvec, topN);
    const graded = await gradedCheck(db, courseId, question, qvec);
    return { hits, graded };
  });

  const { hits, graded } = ctx;
  const sources = toSources(hits);
  let hintsOnly = graded.hit;

  if (hits.length === 0) {
    return {
      answer: 'There is nothing in this course’s materials yet that I can answer from. Once your professor uploads modules or a syllabus, I can help. You can also ask the professor directly in “Ask the professor”.',
      sources: [], hintsOnly, guardrail: { layer1: graded.hit, layer2: false, reason: graded.reason, similarity: graded.similarity },
      linksRemoved: 0, lang: 'en',
    };
  }

  const messages: ChatMessage[] = [{ role: 'system', content: STUDY_RULES('en', hintsOnly) }];
  for (const t of history.slice(-4)) {
    messages.push(t.role === 'user'
      ? { role: 'user', content: untrusted('student_request', t.content.slice(0, 1500)) }
      : { role: 'assistant', content: t.content.slice(0, 2000) });
  }
  messages.push({
    role: 'user',
    content: `Course sources:\n\n${sourceBlock(hits)}\n\nStudent question:\n${untrusted('student_request', question)}`,
  });

  const draft = await llm({ task: 'study_answer', messages, maxTokens: 2500, temperature: 0.2 });
  let answer = draft.content.trim();
  const check = await guardrailCheck(question, answer);
  if (check.flagged) {
    answer = check.text;
    hintsOnly = true;
  }
  const egress = cleanOutput(answer, sources.length);

  await withUser(me.id, async (db) => {
    await recordActivity(db, me, courseId, moduleActivity(hits));
    await audit(db, me.id, 'study_ai_answer', {
      course_id: courseId, sources: sources.length, hints_only: hintsOnly,
      guardrail_layer1: graded.hit, guardrail_layer2: check.flagged,
    });
    if (egress.removed.length) {
      await audit(db, me.id, 'egress_links_removed', { course_id: courseId, count: egress.removed.length, sample: egress.removed.slice(0, 3) });
    }
  });

  return {
    answer: egress.text, sources, hintsOnly,
    guardrail: { layer1: graded.hit, layer2: check.flagged, reason: graded.reason, similarity: graded.similarity },
    linksRemoved: egress.removed.length, lang: 'en',
  };
}

// ------------------------------------------------------------------ summaries and flashcards

type Scope = { documentId?: string; module?: string };

async function scopeChunks(db: Db, courseId: string, scope: Scope) {
  if (scope.documentId) {
    const d = await db.query('SELECT id, title, kind, module, status FROM documents WHERE id = $1 AND course_id = $2', [scope.documentId, courseId]);
    if (!d.rows[0]) throw new HttpError(404, 'Document not found.');
    if (d.rows[0].status !== 'ready') throw new HttpError(409, 'That document is still being read, or could not be read.');
    const c = await db.query(
      `SELECT c.id, c.document_id, NULL::uuid AS clarification_id, c.doc_kind, c.page, c.content, $2::text AS title,
              $3::text AS module, NULL::text AS question_summary, 0 AS score
         FROM chunks c WHERE c.document_id = $1 ORDER BY c.page, c.id LIMIT 40`,
      [scope.documentId, d.rows[0].title, d.rows[0].module]);
    return { label: d.rows[0].title as string, kind: d.rows[0].kind as string, hits: c.rows as Hit[] };
  }
  if (scope.module) {
    const c = await db.query(
      `SELECT c.id, c.document_id, NULL::uuid AS clarification_id, c.doc_kind, c.page, c.content, d.title, d.module,
              NULL::text AS question_summary, 0 AS score
         FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.course_id = $1 AND d.module = $2 AND d.kind = 'module'
        ORDER BY d.created_at, c.page, c.id LIMIT 40`, [courseId, scope.module]);
    if (!c.rows.length) throw new HttpError(404, 'No study materials found for that module.');
    return { label: scope.module, kind: 'module', hits: c.rows as Hit[] };
  }
  throw new HttpError(400, 'Choose a document or a module.');
}

/** Keeps the prompt bounded: up to ~14k characters spread across the document. */
function budget(hits: Hit[], maxChars = 14000): Hit[] {
  const out: Hit[] = [];
  let used = 0;
  const step = Math.max(1, Math.ceil(hits.reduce((s, h) => s + h.content.length, 0) / maxChars));
  hits.forEach((h, i) => {
    if (i % step === 0 && used + h.content.length <= maxChars) {
      out.push(h);
      used += h.content.length;
    }
  });
  return out;
}

export async function summarise(me: Me, courseId: string, scope: Scope) {
  const { label, kind, hits } = await withUser(me.id, async (db) => {
    await requireMember(db, courseId);
    await spend(db, me.id, 'ai', courseId);
    await countRead(db, me.id, courseId, 'study_summary');
    return scopeChunks(db, courseId, scope);
  });
  const picked = budget(hits);
  const graded = kind === 'assignment' || kind === 'quiz';
  const r = await llm({
    task: 'study_answer', maxTokens: 3500, temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `You write study summaries for a university course from the numbered sources only.
Write in English. Structure: a two-sentence overview; then "## Key ideas" as 4 to 6 bullets of at most 30 words each, each starting with the term in bold; then, only if the material has formulas, "## Key formulas" with at most 5 formulas, each on its own line in $$...$$ followed by one short line saying what the symbols mean; then "## Check yourself" with 3 short questions (no answers). Never write a heading without content under it.
Be concise: no quotations, anecdotes or history unless they are the point of the material. Cite sources as [n]. No links or images.
${MATH_RULE}
${graded ? 'This is GRADED WORK. Summarise only what is being asked and which concepts it uses. Do not solve anything or hint at final answers.' : ''}
${DATA_RULE}`,
      },
      { role: 'user', content: `Summarise "${label.replace(/"/g, "'")}".\n\n${sourceBlock(picked)}` },
    ],
  });
  const egress = cleanOutput(dropEmptyHeadings(r.content.trim()), picked.length);
  await withUser(me.id, async (db) => {
    await recordActivity(db, me, courseId, `reviewing ${picked[0]?.module ?? label}`.slice(0, 80));
    await audit(db, me.id, 'study_summary', { course_id: courseId, scope: label, links_removed: egress.removed.length });
  });
  return { summary: egress.text, sources: toSources(picked), hintsOnly: graded, label, linksRemoved: egress.removed.length };
}

export type Flashcard = { front: string; back: string; points: string[]; formula: string | null; source: number | null };

export async function flashcards(me: Me, courseId: string, scope: Scope) {
  const { label, kind, hits } = await withUser(me.id, async (db) => {
    await requireMember(db, courseId);
    await spend(db, me.id, 'ai', courseId);
    await countRead(db, me.id, courseId, 'study_flashcards');
    return scopeChunks(db, courseId, scope);
  });
  if (kind === 'assignment' || kind === 'quiz') {
    throw new HttpError(400, 'Flashcards are not made from graded work. Pick a module instead.');
  }
  const picked = budget(hits, 12000);
  const r = await llmJson<{ cards?: { front?: string; back?: string; points?: unknown; formula?: string; source?: number }[] }>(
    'flashcards',
    `You make exam-revision flashcards from the numbered course sources only. Write them in English.
Return JSON {"cards": [{"front": string, "back": string, "points": string[], "formula": string, "source": number}]} with 8 to 12 cards.
- Cover the ideas a student must understand or apply: definitions, what a method is for, when to use it, how to interpret a result, common mistakes, and key formulas. Skip trivia such as quotations, names and dates unless the course is about them.
- "front": one clear question (not just a term), under 15 words.
- "back": the direct answer in one short sentence.
- "points": 2 or 3 short bullet points (under 15 words each) that add meaning: intuition, how to interpret it, an example, or a pitfall. No repetition of "back".
- "formula": the key formula in LaTeX without $ signs (for example \\hat\\beta_1 = \\frac{\\sum_i (x_i-\\bar x)(y_i-\\bar y)}{\\sum_i (x_i-\\bar x)^2}), or "" if the card has none. Inside "back" and "points", write any symbol in LaTeX between $...$.
- "source": the number of the source the card comes from.
No links or images. ${DATA_RULE}`,
    `Make flashcards for "${label.replace(/"/g, "'")}".\n\n${sourceBlock(picked)}`, 6000, { latex: true });
  const sources = toSources(picked);
  let removed = 0;
  const cards: Flashcard[] = (r.cards ?? []).slice(0, 14).flatMap((c) => {
    if (!c.front || !c.back) return [];
    const f = stripOutsideLinks(String(c.front).slice(0, 300));
    const b = stripOutsideLinks(String(c.back).slice(0, 600));
    const pts = (Array.isArray(c.points) ? c.points : []).slice(0, 4).map((x) => stripOutsideLinks(String(x).slice(0, 240)));
    const fm = c.formula ? stripOutsideLinks(String(c.formula).replace(/^\$+|\$+$/g, '').slice(0, 400)) : null;
    removed += f.removed.length + b.removed.length + pts.reduce((a, x) => a + x.removed.length, 0) + (fm?.removed.length ?? 0);
    const n = Number(c.source);
    return [{
      front: f.text, back: b.text, points: pts.map((x) => x.text).filter(Boolean),
      formula: fm && fm.text.trim() ? fm.text.trim() : null, source: n >= 1 && n <= sources.length ? n : null,
    }];
  });
  await withUser(me.id, async (db) => {
    await recordActivity(db, me, courseId, `making flashcards for ${picked[0]?.module ?? label}`.slice(0, 80));
    await audit(db, me.id, 'study_flashcards', { course_id: courseId, scope: label, cards: cards.length, links_removed: removed });
  });
  return { cards, sources, label, linksRemoved: removed };
}

/** Documents and modules the student can pick from (RLS-scoped). */
export async function studyScopes(me: Me, courseId: string) {
  return withUser(me.id, async (db) => {
    await requireMember(db, courseId);
    const d = await db.query(
      `SELECT id, title, kind, module, visibility, status, page_count, (uploader_id = app_uid()) AS mine
         FROM documents WHERE course_id = $1 ORDER BY kind = 'syllabus' DESC, module NULLS LAST, created_at`, [courseId]);
    const modules = [...new Set(d.rows.filter((x) => x.kind === 'module' && x.module && x.status === 'ready').map((x) => x.module as string))];
    const k = await db.query('SELECT count(*)::int AS n FROM clarifications WHERE course_id = $1', [courseId]);
    return { documents: d.rows, modules, clarifications: k.rows[0].n as number };
  });
}
