'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  BookMarked, Check, ChevronLeft, ChevronRight, Download, FileText, Languages, Layers, Lightbulb, Lock, MessageSquareQuote,
  RotateCcw, Send, Shuffle, Sparkles,
} from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { Markdown, stripCitations } from '@/components/Markdown';
import { Badge, Empty, PageHeader } from '@/components/ui';
import { TAGS } from '../tags';
import { languageName } from '@/lib/languages';
import { ComposeTools } from '@/components/ComposeTools';
import { bestMatch, VoiceButton } from '@/components/VoiceButton';

type Source = {
  n: number; chunk_id: number; document_id: string | null; clarification_id: string | null;
  title: string; module: string | null; kind: string | null; page: number | null; excerpt: string;
};
type Guard = { layer1: boolean; layer2: boolean; reason: string | null; similarity: number };
type AskResult = { answer: string; sources: Source[]; hintsOnly: boolean; guardrail: Guard; linksRemoved: number; lang: string };
type Msg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; result?: AskResult; error?: string };
type Doc = { id: string; title: string; kind: string; module: string | null; visibility: string; status: string; mine: boolean };
type Scopes = { documents: Doc[]; modules: string[]; clarifications: number };
type Card = { front: string; back: string; points?: string[]; formula?: string | null; source: number | null };

const MODES = [
  { id: 'ask', label: 'Ask', icon: MessageSquareQuote },
  { id: 'summary', label: 'Summarise', icon: BookMarked },
  { id: 'cards', label: 'Flashcards', icon: Layers },
] as const;

export function StudyClient({ courseId, courseCode, lang }: { courseId: string; courseCode: string; lang: string }) {
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('ask');
  const [scopes, setScopes] = useState<Scopes | null>(null);

  useEffect(() => {
    api<Scopes>(`/api/courses/${courseId}/study`).then(setScopes).catch(() => setScopes({ documents: [], modules: [], clarifications: 0 }));
  }, [courseId]);

  const ready = scopes?.documents.filter((d) => d.status === 'ready') ?? [];

  return (
    <div>
    <PageHeader title="Study AI" description={TAGS.study} />
    <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-line bg-white p-1" role="tablist" aria-label="Study mode">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
                  className={clsx('flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                    mode === m.id ? 'bg-roo-50 text-roo-700' : 'text-ink-mute hover:bg-slate-50 hover:text-ink')}>
                  <Icon className="h-4 w-4" />{m.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-mute">
            {scopes ? `Reads ${ready.filter((d) => d.visibility === 'class').length} class files · ${ready.filter((d) => d.mine && d.visibility === 'private').length} of yours · ${scopes.clarifications} professor answers` : '…'}
            {' · '}hints only on graded work
          </p>
        </div>
        {mode === 'ask' && <AskPanel courseId={courseId} courseCode={courseCode} lang={lang} hasDocs={ready.length > 0} />}
        {mode === 'summary' && <ScopePanel kind="summary" courseId={courseId} lang={lang} scopes={scopes} />}
        {mode === 'cards' && <ScopePanel kind="cards" courseId={courseId} lang={lang} scopes={scopes} />}
    </div>
    </div>
  );
}

// ------------------------------------------------------------------ Ask

const SUGGESTIONS = [
  'Explain the main idea of the latest module in simple words',
  'What did the professor clarify about the project?',
  'What is due in the next two weeks?',
];

function AskPanel({ courseId, courseCode, lang, hasDocs }: { courseId: string; courseCode: string; lang: string; hasDocs: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  async function send(text?: string) {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ('');
    setBusy(true);
    try {
      const r = await api<AskResult>(`/api/courses/${courseId}/study/ask`, { body: { question, history } });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, result: r }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: '', error: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex h-[calc(100vh-14rem)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex-1 space-y-6 overflow-y-auto p-5" aria-live="polite">
        {msgs.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-roo-50 text-roo-600"><Sparkles className="h-5 w-5" /></div>
            <h3 className="text-base font-semibold">Ask anything about {courseCode}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-mute">From your course files, in any language.</p>
            {!hasDocs && <p className="mx-auto mt-3 max-w-md rounded-lg border border-gold-100 bg-gold-50 px-3 py-2 text-xs text-gold-700">No materials are indexed yet, so there is nothing to answer from.</p>}
            <p className="eyebrow mt-6">Suggested questions</p>
            <div className="mx-auto mt-2 grid max-w-xl gap-2 sm:grid-cols-3">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border border-line bg-white px-3 py-2.5 text-left text-xs text-ink-soft transition-colors hover:border-roo-300 hover:bg-roo-50/40 hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%]">
              <p className="mb-1 text-right text-xs font-medium text-ink-mute">You</p>
              <div className="whitespace-pre-wrap rounded-lg rounded-tr-sm bg-roo-600 px-4 py-2.5 text-sm text-white" dir="auto">{m.content}</div>
            </div>
          </div>
        ) : (
          <AnswerBubble key={i} msg={m} lang={lang} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-mute"><Spinner />Searching course materials, then checking the answer…</div>
        )}
        <div ref={endRef} />
      </div>
      <form className="flex items-end gap-2 border-t border-line bg-white p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea className="input min-h-[44px] resize-none" rows={2} maxLength={1500} value={q} placeholder="Ask about this course, in any language…"
          onChange={(e) => setQ(e.target.value)} aria-label="Your question"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <ComposeTools value={q} onChange={setQ} placement="beside" />
        {msgs.length > 0 && (
          <button type="button" className="btn-ghost px-2" onClick={() => setMsgs([])} title="New conversation" aria-label="New conversation">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <button className="btn-primary h-11 w-11 px-0" disabled={busy || !q.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}

function HintsBanner({ g }: { g?: Guard }) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-gold-100 bg-gold-50 px-3 py-2 text-xs text-gold-700" role="note">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <strong>Hints-only mode: this looks close to graded work.</strong>{' '}
        {g?.layer1 && <span>{g.reason ?? 'Your question is close to an assignment or quiz'} (layer 1, before answering). </span>}
        {g?.layer2 && <span>A second check found a worked final answer in the draft and turned it into guiding questions (layer 2). </span>}
        <span>You get the concepts and questions to work it out, not the answer.</span>
      </div>
    </div>
  );
}

/** English first; one click translates into the student's language, and back. */
function useTranslation(text: string, lang: string, kind: 'study' | 'flashcard' = 'study') {
  const [translated, setTranslated] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (translated) return setOn(!on);
    setBusy(true); setError(null);
    try {
      const t = await api<{ text: string }>('/api/translate', { body: { text, kind, target: lang } });
      setTranslated(t.text); setOn(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return { shown: on && translated ? translated : text, on, busy, error, toggle, available: lang !== 'en' };
}

function TranslateButton({ t, lang }: { t: ReturnType<typeof useTranslation>; lang: string }) {
  if (!t.available) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={t.toggle} className="inline-flex items-center gap-1 text-xs font-medium text-roo-600 hover:underline" disabled={t.busy}>
        {t.busy ? <Spinner className="h-3 w-3" /> : <Languages className="h-3 w-3" />}
        {t.on ? 'Show original (English)' : `Translate to ${languageName(lang)}`}
      </button>
      {t.error && <span className="text-xs text-red-600">{t.error}</span>}
    </span>
  );
}

function AnswerBubble({ msg, lang }: { msg: Extract<Msg, { role: 'assistant' }>; lang: string }) {
  const t = useTranslation(msg.content, lang);
  if (msg.error) {
    return <div className="max-w-[85%] rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{msg.error}</div>;
  }
  const r = msg.result;
  return (
    <div className="max-w-[92%]">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-mute"><Sparkles className="h-3.5 w-3.5 text-roo-600" />Study AI</p>
      {r?.hintsOnly && <HintsBanner g={r.guardrail} />}
      <div className="rounded-lg rounded-tl-sm border border-line bg-slate-50 px-4 py-3" dir="auto" lang={t.on ? lang : 'en'}>
        <Markdown text={stripCitations(t.shown)} />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <TranslateButton t={t} lang={lang} />
          {r && r.linksRemoved > 0 && <Badge tone="red">{r.linksRemoved} outside link{r.linksRemoved > 1 ? 's' : ''} removed</Badge>}
        </div>
      </div>
      {r && r.sources.length > 0 && <SourceLine sources={citedOnly(r.sources, msg.content)} />}
    </div>
  );
}

/** Keep only the sources the answer actually cited (all of them if it cited none). */
function citedOnly(sources: Source[], text: string) {
  const used = new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  const hit = sources.filter((s) => used.has(s.n));
  return hit.length ? hit : sources;
}

/** One line per file: "Source: Chapter 3 · pp. 1, 3, 5". Each source is named once. */
function SourceLine({ sources }: { sources: Source[] }) {
  const groups = new Map<string, { title: string; module: string | null; docId: string | null; prof: boolean; graded: boolean; pages: Set<number> }>();
  for (const s of sources) {
    const key = s.document_id ?? `k:${s.clarification_id ?? s.title}`;
    const g = groups.get(key) ?? { title: s.title, module: s.module, docId: s.document_id, prof: !!s.clarification_id, graded: s.kind === 'assignment' || s.kind === 'quiz', pages: new Set<number>() };
    if (s.page) g.pages.add(s.page);
    groups.set(key, g);
  }
  return (
    <ul className="mt-2 space-y-1 text-xs text-ink-mute">
      {[...groups.values()].map((g, i) => {
        const pages = [...g.pages].sort((a, b) => a - b);
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-medium text-ink-soft">{i === 0 ? 'Source:' : 'Also:'}</span>
            <span className="text-ink">{g.prof ? 'Professor’s clarification' : g.title}{g.module && !g.prof ? ` (${g.module})` : ''}</span>
            {pages.length > 0 && <span>· {pages.length === 1 ? 'p.' : 'pp.'} {pages.join(', ')}</span>}
            {g.graded && <Badge tone="gold"><Lock className="h-3 w-3" />Graded</Badge>}
            {g.docId && (
              <a href={`/api/documents/${g.docId}`} className="inline-flex items-center hover:text-roo-600" title="Download" aria-label={`Download ${g.title}`}>
                <Download className="h-3.5 w-3.5" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ Summaries and flashcards

function ScopePanel({ kind, courseId, lang, scopes }: { kind: 'summary' | 'cards'; courseId: string; lang: string; scopes: Scopes | null }) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<{ cards: Card[]; sources: Source[]; label: string } | null>(null);

  if (!scopes) return <Spinner />;
  const docs = scopes.documents.filter((d) => d.status === 'ready' && (kind === 'summary' || (d.kind !== 'assignment' && d.kind !== 'quiz')));
  if (!docs.length) {
    return <Empty icon={<FileText />} title="Nothing to study from yet">Once materials are uploaded and indexed they appear here.</Empty>;
  }

  async function run() {
    if (!pick) return;
    setBusy(true); setErr(null);
    const [t, v] = pick.split(':');
    const scope = t === 'm' ? { module: v } : { documentId: v };
    try {
      if (kind === 'summary') setSummary(await api(`/api/courses/${courseId}/study/summary`, { body: scope }));
      else setCards(await api(`/api/courses/${courseId}/study/flashcards`, { body: scope }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="scope">{kind === 'summary' ? 'Summarise' : 'Make flashcards for'}</label>
          <select id="scope" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a module or document…</option>
            {scopes.modules.length > 0 && (
              <optgroup label="Whole modules">
                {scopes.modules.map((m) => <option key={m} value={`m:${m}`}>{m}</option>)}
              </optgroup>
            )}
            <optgroup label="Single documents">
              {docs.map((d) => (
                <option key={d.id} value={`d:${d.id}`}>{d.title}{d.module ? ` (${d.module})` : ''}{d.mine && d.visibility === 'private' ? ' · private' : ''}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <VoiceButton label={kind === 'summary' ? 'Say what to summarise, e.g. “Module 4”' : 'Say what to make flashcards for, e.g. “Module 4”'}
          onFinal={(heard) => {
            const options = [
              ...scopes.modules.map((m) => ({ value: `m:${m}`, label: m })),
              ...docs.map((d) => ({ value: `d:${d.id}`, label: `${d.title} ${d.module ?? ''}` })),
            ];
            const hit = bestMatch(heard, options);
            if (hit) setPick(hit.value);
            else setErr(`I heard “${heard}”, but no module or document matches. Pick one from the list.`);
          }} />
        <button className="btn-primary" onClick={run} disabled={!pick || busy}>
          {busy ? <Spinner /> : kind === 'summary' ? <BookMarked className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
          {kind === 'summary' ? 'Summarise' : 'Make flashcards'}
        </button>
        {err && <p className="w-full text-sm text-red-600" role="alert">{err}</p>}
      </div>

      {kind === 'summary' && summary && <SummaryCard key={summary.summary.length + summary.label} summary={summary} lang={lang} />}
      {kind === 'cards' && cards && cards.cards.length > 0 && <Deck key={cards.label + cards.cards.length} cards={cards.cards} sources={cards.sources} label={cards.label} lang={lang} />}
    </div>
  );
}

type Summary = { summary: string; sources: Source[]; hintsOnly: boolean; label: string; linksRemoved: number };

function SummaryCard({ summary, lang }: { summary: Summary; lang: string }) {
  const t = useTranslation(summary.summary, lang);
  return (
    <div className="card p-5" lang={t.on ? lang : 'en'}>
      {summary.hintsOnly && <HintsBanner />}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{summary.label}</h3>
        <TranslateButton t={t} lang={lang} />
      </div>
      <Markdown text={stripCitations(t.shown)} />
      {summary.linksRemoved > 0 && <Badge tone="red" className="mt-2">{summary.linksRemoved} outside links removed</Badge>}
      <SourceLine sources={citedOnly(summary.sources, summary.summary)} />
    </div>
  );
}

/** Interactive deck: one card at a time. Click or Space flips, arrow keys move, and you sort cards into known / still learning. */
/** The whole deck goes to the translator in one call, each field behind a [[F1]]-style marker. */
function deckText(cards: Card[]) {
  return cards.map((c, i) => [`[[F${i}]] ${c.front}`, `[[B${i}]] ${c.back}`, ...(c.points ?? []).map((p, j) => `[[P${i}.${j}]] ${p}`)].join('\n')).join('\n');
}
function parseDeck(text: string, cards: Card[]): Card[] | null {
  const parts = new Map<string, string>();
  for (const m of text.matchAll(/\[\[([FBP][\d.]+)\]\]\s*([\s\S]*?)(?=\n?\[\[[FBP][\d.]+\]\]|$)/g)) parts.set(m[1], m[2].trim());
  const out = cards.map((c, i) => ({
    ...c,
    front: parts.get(`F${i}`) ?? '', back: parts.get(`B${i}`) ?? '',
    points: (c.points ?? []).map((p, j) => parts.get(`P${i}.${j}`) ?? p),
  }));
  return out.every((c) => c.front && c.back) ? out : null;
}

function Deck({ cards: english, sources, label, lang }: { cards: Card[]; sources: Source[]; label: string; lang: string }) {
  const tr = useTranslation(deckText(english), lang, 'flashcard');
  const translatedDeck = tr.on ? parseDeck(tr.shown, english) : null;
  const cards = translatedDeck ?? english;
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const done = pos >= order.length;
  const idx = order[pos];
  const card = done ? null : cards[idx];
  const source = card?.source ? sources[card.source - 1] : undefined;

  const go = (d: number) => { setFlipped(false); setPos((p) => Math.max(0, Math.min(order.length, p + d))); };
  const mark = (k: boolean) => {
    setKnown((s) => { const n = new Set(s); if (k) n.add(idx); else n.delete(idx); return n; });
    go(1);
  };
  const restart = (list: number[]) => { setOrder(list); setPos(0); setFlipped(false); };
  const shuffle = () => restart([...order].sort(() => Math.random() - 0.5));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      if (e.key === ' ' || e.key === 'Enter') { if (!done) { e.preventDefault(); setFlipped((f) => !f); } }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (flipped && (e.key === '1' || e.key === '2')) mark(e.key === '2');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const progress = Math.round((Math.min(pos, order.length) / order.length) * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex flex-wrap items-center gap-3"><span className="font-medium text-ink">{label}</span><TranslateButton t={tr} lang={lang} />
          {tr.on && !translatedDeck && <span className="text-xs text-red-600">Translation didn’t come back cleanly; showing English.</span>}</span>
        <span className="tabular-nums text-ink-mute">{done ? order.length : pos + 1} / {order.length} · {known.size} known</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div className="h-full bg-roo-600 transition-all" style={{ width: `${progress}%` }} />
      </div>

      {card ? (
        <>
          <div className="[perspective:1600px]">
            <button type="button" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}
              aria-label={flipped ? 'Answer side. Click to see the question' : 'Question side. Click to see the answer'}
              className={clsx('relative block min-h-[320px] w-full text-left transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none',
                flipped && '[transform:rotateY(180deg)]')}>
              <span className="card absolute inset-0 flex flex-col p-6 [backface-visibility:hidden]" dir="auto" lang={translatedDeck ? lang : 'en'}>
                <span className="eyebrow">Question</span>
                <span className="flex flex-1 items-center justify-center py-4 text-center text-xl font-semibold leading-snug text-ink">
                  <Markdown text={card.front} className="prose-rr text-xl" />
                </span>
                <span className="text-center text-xs text-ink-mute">Click or press Space to flip</span>
              </span>
              <span className="card absolute inset-0 flex flex-col overflow-y-auto border-roo-200 bg-roo-50/40 p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]" dir="auto" lang={translatedDeck ? lang : 'en'}>
                <span className="eyebrow text-roo-700">Answer</span>
                <span className="mt-2 block text-base font-medium text-ink"><Markdown text={card.back} /></span>
                {card.formula && (
                  <span className="mt-3 block rounded-lg border border-line bg-white px-4 py-1 text-ink"><Markdown text={`$$\n${card.formula}\n$$`} /></span>
                )}
                {!!card.points?.length && (
                  <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
                    {card.points.map((p, i) => (
                      <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-roo-500" /><Markdown text={p} /></li>
                    ))}
                  </ul>
                )}
                {source && <span className="mt-auto pt-3 text-xs text-ink-mute">{source.title}{source.page ? ` · p. ${source.page}` : ''}</span>}
              </span>
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button className="btn-ghost" onClick={() => go(-1)} disabled={pos === 0} aria-label="Previous card"><ChevronLeft className="h-4 w-4" />Back</button>
            {flipped ? (
              <div className="flex gap-2">
                <button className="btn-outline" onClick={() => mark(false)}><RotateCcw className="h-4 w-4" />Still learning</button>
                <button className="btn-primary" onClick={() => mark(true)}><Check className="h-4 w-4" />Got it</button>
              </div>
            ) : (
              <button className="btn-outline" onClick={() => setFlipped(true)}>Show answer</button>
            )}
            <button className="btn-ghost" onClick={() => go(1)} aria-label="Next card">Skip<ChevronRight className="h-4 w-4" /></button>
          </div>
          <p className="mt-3 text-center text-xs text-ink-mute">Keys: Space flip · ← → move · 1 still learning · 2 got it</p>
        </>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold text-ink">Deck finished</p>
          <p className="mt-1 text-sm text-ink-mute">{known.size} of {order.length} known · {order.length - known.size} still learning</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {order.length - known.size > 0 && (
              <button className="btn-primary" onClick={() => restart(order.filter((i) => !known.has(i)))}><RotateCcw className="h-4 w-4" />Review the {order.length - known.size} still learning</button>
            )}
            <button className="btn-outline" onClick={() => { setKnown(new Set()); restart(cards.map((_, i) => i)); }}>Start over</button>
          </div>
        </div>
      )}
      {!done && (
        <div className="mt-2 flex justify-center">
          <button className="btn-ghost btn-sm" onClick={shuffle}><Shuffle className="h-3.5 w-3.5" />Shuffle</button>
        </div>
      )}
    </div>
  );
}
