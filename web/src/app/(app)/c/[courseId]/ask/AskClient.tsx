'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock3, Languages, Megaphone, MessageCircleQuestion, Search, Send } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { Markdown } from '@/components/Markdown';
import { Badge, Empty } from '@/components/ui';
import { When } from './When';
import { ComposeTools } from '@/components/ComposeTools';

type Match = { id: string; summary: string | null; answer: string; similarity: number };
type Result =
  | { status: 'already_answered'; matches: Match[] }
  | { status: 'submitted'; questionId: string; clusterStatus: 'waiting' | 'digest'; english: string; redacted: string; wordsRemoved?: boolean };

export function AskForm({ courseId, topics, initial, threshold }: { courseId: string; topics: string[]; initial: string; threshold: number }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function send(force = false) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Result>(`/api/courses/${courseId}/questions`, { body: { text, module: topic || null, force } });
      setRes(r);
      if (r.status === 'submitted') {
        setText('');
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h2 className="card-title"><MessageCircleQuestion className="h-4 w-4 text-ink-mute" />Submit a question</h2>
      </div>
      <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="label" htmlFor="question">Your question</label>
        <div className="relative">
          <textarea id="question" className="input min-h-[120px] resize-y pb-10" dir="auto" maxLength={1500} value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Does Part 3 of the project need unit tests? / ¿La parte 3 necesita pruebas unitarias?" />
          <ComposeTools value={text} onChange={setText} />
        </div>
        <div>
          <label className="label" htmlFor="topic">Topic, module or assignment</label>
          <select id="topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">General</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {err && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || text.trim().length < 3}>
          {busy ? <Spinner /> : <Send className="h-4 w-4" />}{busy ? 'Translating and removing names…' : 'Ask anonymously'}
        </button>
        <p className="text-xs text-ink-mute">Names removed · your professor never sees who asked.</p>
      </form>

      {res?.status === 'already_answered' && (
        <div className="border-t border-line bg-emerald-50/60 p-5" role="status">
          <p className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />Your professor may already have answered this</p>
          <div className="mt-3 space-y-3">
            {res.matches.map((m) => (
              <a key={m.id} href={`#k-${m.id}`} className="block rounded-lg border border-emerald-100 bg-white p-3 text-sm hover:border-emerald-300">
                {m.summary && <p className="font-semibold text-ink">{m.summary}</p>}
                <p className="mt-1 line-clamp-3 text-ink-soft">{m.answer}</p>
              </a>
            ))}
          </div>
          <button className="btn-outline mt-3" onClick={() => send(true)} disabled={busy}>My question is different, send it</button>
        </div>
      )}

      {res?.status === 'submitted' && (
        <div className="border-t border-line bg-roo-50/50 p-5" role="status">
          <p className="flex items-center gap-2 font-semibold text-roo-800"><CheckCircle2 className="h-4 w-4" />Sent to the question pool</p>
          <p className="eyebrow mt-2">What enters the pool (names removed)</p>
          <p className="mt-1 rounded-lg border border-line bg-white p-3 text-sm text-ink">{res.redacted}</p>
          {res.wordsRemoved && <p className="mt-2 text-xs text-gold-700">Abusive words were removed before it entered the pool.</p>}
          <p className="mt-2 text-sm text-ink-soft">
            {res.clusterStatus === 'digest'
              ? 'Enough classmates asked something similar: your professor now sees one anonymous summary of all of them.'
              : `Your professor can read it now, without your name. When ${threshold}+ students ask something similar, it becomes one summary.`}
          </p>
        </div>
      )}
    </div>
  );
}

type Mine = { id: string; text_original: string; status: string; module: string | null; created_at: string; clarification_id: string | null };

export function MyQuestions({ questions }: { questions: Mine[] }) {
  if (!questions.length) return null;
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h3 className="card-title">Your questions</h3>
        <p className="text-xs text-ink-mute">Only you can see this list.</p>
      </div>
      <ul className="divide-y divide-line">
        {questions.map((q) => (
          <li key={q.id} className="px-5 py-3">
            <p className="text-sm text-ink" dir="auto">{q.text_original}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
              {q.status === 'answered' && q.clarification_id ? (
                <a href={`#k-${q.clarification_id}`}><Badge tone="green"><CheckCircle2 className="h-3 w-3" />Answered, see below</Badge></a>
              ) : q.status === 'answered' ? (
                <Badge tone="green"><CheckCircle2 className="h-3 w-3" />Answered</Badge>
              ) : (
                <Badge tone="gold"><Clock3 className="h-3 w-3" />Waiting for similar questions</Badge>
              )}
              {q.module && <Badge>{q.module}</Badge>}
              <When iso={q.created_at} mode="relative" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Clarification(p: {
  id: string; lang: string; summary: string | null; answer: string; summaryLocal: string | null; answerLocal: string | null;
  publishedAt: string; professor: string;
}) {
  const translated = p.lang !== 'en' && !!p.answerLocal;
  const [original, setOriginal] = useState(false);
  const showLocal = translated && !original;
  return (
    <article id={`k-${p.id}`} className="card scroll-mt-24 p-5 target:ring-2 target:ring-roo-300">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
        <Badge tone="blue">Clarification</Badge>
        <span>{p.professor}</span>·<When iso={p.publishedAt} mode="relative" />
      </div>
      {p.summary && (
        <p className="mt-3 text-[15px] font-semibold text-ink" dir="auto">{showLocal && p.summaryLocal ? p.summaryLocal : p.summary}
        </p>
      )}
      <div className="mt-2 border-l-2 border-roo-200 pl-3" dir="auto"><Markdown text={showLocal ? p.answerLocal! : p.answer} /></div>
      {translated && (
        <button className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-roo-600 hover:underline" onClick={() => setOriginal(!original)}>
          <Languages className="h-3 w-3" />{original ? 'Show in my language' : 'Show original (English)'}
        </button>
      )}
    </article>
  );
}

type ClarItem = { id: string; summary: string | null; answer: string; summaryLocal: string | null; answerLocal: string | null; publishedAt: string };

/** Published clarifications with a search box. Filtering happens on what is already on the page. */
export function ClarificationList({ items, lang, professor }: { items: ClarItem[]; lang: string; professor: string }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((a) => [a.summary, a.answer, a.summaryLocal, a.answerLocal].some((x) => x?.toLowerCase().includes(t)));
  }, [items, q]);
  if (items.length === 0) {
    return (
      <Empty icon={<Megaphone />} title="No clarifications yet">
        When enough classmates ask something similar, your professor answers everyone at once.
      </Empty>
    );
  }
  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" aria-hidden />
        <input className="input pl-9 pr-20" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clarifications"
          aria-label="Search clarifications" type="search" />
        <ComposeTools value={q} onChange={setQ} className="!bottom-0.5" />
      </div>
      <p className="mb-3 text-xs text-ink-mute" aria-live="polite">{shown.length} of {items.length} clarification{items.length === 1 ? '' : 's'}</p>
      <div className="space-y-3">
        {shown.map((a) => <Clarification key={a.id} {...a} lang={lang} professor={professor} />)}
      </div>
    </div>
  );
}
