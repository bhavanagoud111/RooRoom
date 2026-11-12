'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Ban, CheckCircle2, Clock3,  MessageSquareHeart, PauseCircle, RefreshCw, Reply, Send, ShieldAlert } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { Badge, Empty } from '@/components/ui';
import { When } from '../ask/When';
import { ComposeTools } from '@/components/ComposeTools';

type Gate = { open: boolean; reason: string | null; usedThisWeek: number; weeklyLimit: number; smallClass: boolean; suspendedUntil: string | null; strikes: number };
type Result =
  | { status: 'suggest_question_pool'; askUrl: string }
  | { status: 'blocked'; labels: string[]; reasons: string[]; strikes: number; suspended: boolean }
  | { status: 'held' }
  | { status: 'queued'; deliverAfter: string };

export function NoteCompose({ courseId, professor, gate, rules }: { courseId: string; professor: string; gate: Gate; rules: string[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function send(sendAnyway = false) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Result>(`/api/courses/${courseId}/notes`, { body: { text, sendAnyway } });
      setRes(r);
      if (r.status === 'queued' || r.status === 'held') setText('');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h2 className="card-title"><MessageSquareHeart className="h-4 w-4 text-ink-mute" />Write a note to {professor}</h2>
      </div>
      <div className="space-y-4 p-5">
        {gate.smallClass && (
          <p className="flex gap-2 rounded-lg border border-gold-100 bg-gold-50 px-3 py-2 text-sm text-gold-700" role="note">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            This class has fewer than 10 students. Your professor may still guess who wrote a note from its content or writing style.
          </p>
        )}
        {!gate.open ? (
          <p className="flex gap-2 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-ink-soft" role="status">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />{gate.reason}
          </p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="space-y-3">
            <label className="label" htmlFor="note">Your note</label>
            <div className="relative">
              <textarea id="note" className="input min-h-[150px] resize-y pb-10" dir="auto" maxLength={2000} value={text}
                onChange={(e) => { setText(e.target.value); setRes(null); }}
                placeholder="Write in any language. Be honest; be fair." />
              <ComposeTools value={text} onChange={(v) => { setText(v); setRes(null); }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-ink-mute">{gate.usedThisWeek} of {gate.weeklyLimit} notes used this week in this course</span>
              <button className="btn-primary" disabled={busy || text.trim().length < 5}>
                {busy ? <Spinner /> : <Send className="h-4 w-4" />}{busy ? 'Screening…' : 'Send anonymously'}
              </button>
            </div>
          </form>
        )}
        {err && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
        <ResultCard res={res} onSendAnyway={() => send(true)} busy={busy} />

        <p className="text-xs text-ink-mute">Screened before delivery · arrives without your name in a daily 8:00 batch · be honest, be fair.</p>
      </div>
    </div>
  );
}

function ResultCard({ res, onSendAnyway, busy }: { res: Result | null; onSendAnyway: () => void; busy: boolean }) {
  if (!res) return null;
  if (res.status === 'queued') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Screened and queued</p>
        <p className="mt-1">Names and identifying details were removed. It will be delivered in the next batch, <When iso={res.deliverAfter} />.</p>
      </div>
    );
  }
  if (res.status === 'held') {
    return (
      <div className="rounded-lg border border-gold-100 bg-gold-50 p-4 text-sm text-gold-700" role="status">
        <p className="flex items-center gap-2 font-semibold"><PauseCircle className="h-4 w-4" />Held, not sent</p>
        <p className="mt-1">Screening is unavailable right now, so your note was held instead of being sent unchecked. Retry it from the list on the right.</p>
      </div>
    );
  }
  if (res.status === 'suggest_question_pool') {
    return (
      <div className="rounded-lg border border-roo-200 bg-roo-50 p-4 text-sm text-roo-800" role="status">
        <p className="font-semibold">This looks like a question about course content.</p>
        <p className="mt-1">If you ask it in the question pool, your professor can answer the whole class at once, and you stay anonymous there too.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={res.askUrl} className="btn-primary">Ask it in the question pool</Link>
          <button className="btn-outline" onClick={onSendAnyway} disabled={busy}>It’s feedback, send as a note</button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <p className="flex items-center gap-2 font-semibold"><Ban className="h-4 w-4" />Not delivered</p>
      <p className="mt-1">This note broke a rule: <strong>{res.reasons.join(', ')}</strong>. You can rewrite it as fair criticism, which is always welcome.</p>
      <p className="mt-2 text-xs">
        {res.suspended
          ? 'This was your third blocked note in this course, so anonymous notes are suspended for you here until the end of term.'
          : `Blocked notes count as strikes (${res.strikes} of 3). After three, anonymous notes are suspended for you in this course for the term.`}
      </p>
    </div>
  );
}

type MyNote = {
  id: string; status: string; labels: string[]; body: string; created_at: string; delivered_at: string | null;
  deliver_after: string | null; replies: { id: string; body: string; created_at: string }[];
};

export function NoteThread({ notes, labelText }: { notes: MyNote[]; labelText: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function retry(id: string) {
    setBusy(id);
    await api(`/api/notes/${id}/retry`, { body: {} }).catch(() => {});
    setBusy(null);
    router.refresh();
  }
  return (
    <aside className="space-y-3" aria-labelledby="thread-title">
      <div>
        <h2 id="thread-title" className="text-base font-semibold text-ink">Your notes and replies</h2>
        <p className="text-xs text-ink-mute">Only you see this. Replies from your professor appear under each note.</p>
      </div>
      {notes.length === 0 ? <Empty title="No notes yet">Your notes and any replies will appear here.</Empty> : notes.map((n) => (
        <div key={n.id} className="card p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <StatusBadge status={n.status} />
            <span className="text-xs text-ink-mute"><When iso={n.created_at} mode="relative" /></span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-ink" dir="auto">{n.body}</p>
          {n.status === 'queued' && n.deliver_after && <p className="mt-2 text-xs text-ink-mute">Delivers <When iso={n.deliver_after} /></p>}
          {n.status === 'blocked' && (
            <p className="mt-2 flex items-start gap-1 text-xs text-red-700"><ShieldAlert className="mt-px h-3 w-3 shrink-0" />
              {n.labels.map((l) => labelText[l] ?? l).join(', ')}</p>
          )}
          {n.status === 'held' && (
            <button className="btn-outline btn-sm mt-2" onClick={() => retry(n.id)} disabled={busy === n.id}>
              {busy === n.id ? <Spinner /> : <RefreshCw className="h-3 w-3" />}Retry screening
            </button>
          )}
          {n.replies.map((r) => (
            <div key={r.id} className="mt-3 rounded-md border-l-2 border-roo-500 bg-slate-50 px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-semibold text-roo-700"><Reply className="h-3 w-3" />Your professor replied · <When iso={r.created_at} mode="relative" /></p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink" dir="auto">{r.body}</p>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'delivered') return <Badge tone="green"><CheckCircle2 className="h-3 w-3" />Delivered</Badge>;
  if (status === 'queued') return <Badge tone="blue"><Clock3 className="h-3 w-3" />Queued for the daily batch</Badge>;
  if (status === 'held') return <Badge tone="gold"><PauseCircle className="h-3 w-3" />Held</Badge>;
  return <Badge tone="red"><Ban className="h-3 w-3" />Blocked</Badge>;
}
