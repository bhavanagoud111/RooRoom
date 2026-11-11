'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, RefreshCw, Send, Sparkles, Users, Wand2 } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { Badge } from '@/components/ui';
import { When } from '../ask/When';

export type Digest = { id: string; summary: string | null; module: string | null; count: number; updated_at: string };

export function DigestCard({ d, courseId }: { d: Digest; courseId: string }) {
  const router = useRouter();
  const [answer, setAnswer] = useState('');
  const [drafted, setDrafted] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | 'digest' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function draft() {
    setBusy('draft'); setErr(null);
    try {
      const r = await api<{ draft: string }>(`/api/clusters/${d.id}/draft`, { body: {} });
      setAnswer(r.draft); setDrafted(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function publish() {
    setBusy('publish'); setErr(null);
    try {
      await api(`/api/courses/${courseId}/clarifications`, { body: { clusterId: d.id, answer } });
      router.refresh();
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  }
  async function regen() {
    setBusy('digest'); setErr(null);
    try { await api(`/api/clusters/${d.id}/digest`, { body: {} }); router.refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <article className="card overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-gold-100 bg-gold-50 text-gold-700">
          <span className="text-xl font-semibold leading-none tabular-nums">{d.count}</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase">students</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
            {d.module && <Badge tone="blue">{d.module}</Badge>}
            <span>updated <When iso={d.updated_at} mode="relative" /></span>
          </div>
          {d.summary ? (
            <p className="mt-1 text-base font-semibold leading-snug text-ink">{d.summary}</p>
          ) : (
            <div className="mt-1">
              <p className="text-ink-soft">{d.count} students asked similar questions. The summary is not ready yet.</p>
              <button className="btn-outline btn-sm mt-2" onClick={regen} disabled={!!busy}>
                {busy === 'digest' ? <Spinner /> : <RefreshCw className="h-3 w-3" />}Write the summary
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line bg-slate-50 p-5">
        <div className="mb-2 flex items-center justify-between">
          <label className="label mb-0" htmlFor={`a-${d.id}`}>Your answer to the whole class</label>
          <button className="btn-outline btn-sm" onClick={draft} disabled={!!busy || !d.summary}>
            {busy === 'draft' ? <Spinner /> : <Wand2 className="h-3.5 w-3.5" />}Draft from syllabus
          </button>
        </div>
        {drafted && (
          <p className="mb-2 flex items-center gap-1 text-xs text-roo-700"><Sparkles className="h-3 w-3" />
            AI draft from your course materials. Check it and edit it; nothing is sent until you publish.</p>
        )}
        <textarea id={`a-${d.id}`} className="input min-h-[110px]" value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder="Yes: Part 3 needs at least three unit tests for the routing table…" />
        {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-xs text-ink-mute"><Users className="h-3 w-3" />Goes to every student, translated, and into the Study AI</span>
          <button className="btn-primary" onClick={publish} disabled={!!busy || answer.trim().length < 2}>
            {busy === 'publish' ? <Spinner /> : <Send className="h-4 w-4" />}Publish to class
          </button>
        </div>
      </div>
    </article>
  );
}

export function Announce({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api(`/api/courses/${courseId}/clarifications`, { body: { clusterId: null, title: title || null, answer } });
      setTitle(''); setAnswer(''); setDone(true); router.refresh();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={go} className="card space-y-3 p-5">
      <h3 className="card-title"><Megaphone className="h-4 w-4 text-ink-mute" />Announce to the class</h3>
      <input className="input" aria-label="Announcement topic" placeholder="Topic (optional), e.g. HW3 deadline" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <textarea className="input min-h-[90px]" aria-label="Announcement" placeholder="Write your announcement" value={answer} onChange={(e) => { setAnswer(e.target.value); setDone(false); }} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      {done && <p className="text-sm text-emerald-700" role="status">Published.</p>}
      <button className="btn-outline w-full" disabled={busy || answer.trim().length < 2}>{busy && <Spinner />}Publish</button>
    </form>
  );
}

type Row = { topic: string; open: number; answered: number; clusters: number };

/** Cluster counts grouped by module or assignment: where the class is confused, at a glance. */
export function ConfusionMap({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.open + r.answered));
  return (
    <div className="card p-5">
      <h3 className="card-title">Confusion map</h3>
      <p className="mb-4 text-xs text-ink-mute">Students per topic, from groups that reached the threshold.</p>
      {rows.length === 0 ? <p className="text-sm text-ink-mute">No data yet.</p> : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const heat = r.open / Math.max(1, r.open + r.answered);
            return (
              <li key={r.topic}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="truncate font-medium text-ink">{r.topic}</span>
                  <span className="text-xs text-ink-mute">{r.open > 0 ? `${r.open} open` : 'all answered'}{r.answered ? ` · ${r.answered} answered` : ''}</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-sm bg-slate-100" role="img"
                  aria-label={`${r.topic}: ${r.open} students with open questions, ${r.answered} answered`}>
                  <div style={{ width: `${(r.open / max) * 100}%`, background: heat > 0.5 ? '#D97706' : '#F59E0B' }} />
                  <div className="bg-emerald-500" style={{ width: `${(r.answered / max) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex gap-4 text-[11px] text-ink-mute">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-gold-500" />open</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-500" />answered</span>
      </div>
    </div>
  );
}
