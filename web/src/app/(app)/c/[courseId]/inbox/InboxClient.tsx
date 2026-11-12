'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellOff, Flag, Inbox, Power, Reply, RotateCw, Send } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { Badge, Empty } from '@/components/ui';
import { When } from '../ask/When';
import { ComposeTools } from '@/components/ComposeTools';

type Note = { id: string; body: string; delivered_at: string; reported: boolean; replies: { id: string; body: string; created_at: string }[] };

export function InboxClient({ courseId, notes, notesEnabled, mutedUntil, demo }: {
  courseId: string; notes: Note[]; notesEnabled: boolean; mutedUntil: string | null; demo: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function settings(body: Record<string, unknown>, key: string) {
    setBusy(key);
    await api(`/api/courses/${courseId}/course-settings`, { method: 'PATCH', body }).catch((e) => setMsg(e.message));
    setBusy(null);
    router.refresh();
  }
  // Reload: in demo mode, first deliver any queued notes (instead of waiting for 8:00),
  // then reload the whole page so new notes always show.
  async function reload() {
    setBusy('reload');
    if (demo) {
      try {
        await api(`/api/courses/${courseId}/notes/deliver`, { body: {} });
      } catch (e) { setMsg((e as Error).message); setBusy(null); return; }
    }
    window.location.reload();
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">Inbox <span className="font-normal text-ink-mute">· {notes.length} delivered</span></h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={reload} disabled={!!busy}
            title={demo ? 'Deliver waiting notes now and reload the inbox' : 'Reload the inbox'}>
            {busy === 'reload' ? <Spinner /> : <RotateCw className="h-4 w-4" />}Reload
          </button>
          <button className="btn-outline" onClick={() => settings({ muteWeek: !mutedUntil }, 'mute')} disabled={!!busy}>
            {busy === 'mute' ? <Spinner /> : <BellOff className="h-4 w-4" />}{mutedUntil ? 'Unmute' : 'Mute for a week'}
          </button>
          <button className={notesEnabled ? 'btn-danger' : 'btn-primary'} onClick={() => settings({ notesEnabled: !notesEnabled }, 'power')} disabled={!!busy}>
            {busy === 'power' ? <Spinner /> : <Power className="h-4 w-4" />}{notesEnabled ? 'Turn notes off' : 'Turn notes on'}
          </button>
        </div>
      </div>
      {(mutedUntil || !notesEnabled) && (
        <p className="mb-4 rounded-lg border border-gold-100 bg-gold-50 px-3 py-2 text-sm text-gold-700" role="status">
          {!notesEnabled ? 'Notes are off for this course. Students see that notes are closed.' : <>Notes are muted until <When iso={mutedUntil} mode="date" />.</>}
        </p>
      )}
      {msg && <p className="mb-4 rounded-lg border border-roo-100 bg-roo-50 px-3 py-2 text-sm text-roo-700" role="status">{msg}</p>}
      {notes.length === 0 ? (
        <Empty icon={<Inbox />} title="No notes yet">Delivered notes appear here after the daily 8:00 batch.</Empty>
      ) : (
        <div className="space-y-4">{notes.map((n) => <NoteCard key={n.id} n={n} />)}</div>
      )}
    </section>
  );
}

function NoteCard({ n }: { n: Note }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'none' | 'reply' | 'report'>('none');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      if (mode === 'reply') await api(`/api/notes/${n.id}/reply`, { body: { text } });
      else await api(`/api/notes/${n.id}/report`, { body: { reason: text } });
      setText(''); setMode('none'); router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <article className="card p-5">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-mute">
        <Badge tone="gray">Anonymous student</Badge>
        <span>delivered <When iso={n.delivered_at} /></span>
        {n.reported && <Badge tone="red"><Flag className="h-3 w-3" />Reported</Badge>}
      </div>
      {/* Plain text only: React escapes it, and nothing student-written is ever rendered as HTML. */}
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{n.body}</p>
      {n.replies.map((r) => (
        <div key={r.id} className="mt-3 rounded-md border-l-2 border-roo-500 bg-slate-50 px-3 py-2 text-sm">
          <p className="text-xs font-semibold text-roo-700">You replied · <When iso={r.created_at} mode="relative" /></p>
          <p className="mt-1 whitespace-pre-wrap text-ink">{r.body}</p>
        </div>
      ))}
      {mode === 'none' ? (
        <div className="mt-3 flex gap-2">
          <button className="btn-outline btn-sm" onClick={() => setMode('reply')}><Reply className="h-4 w-4" />Reply</button>
          {!n.reported && <button className="btn-ghost btn-sm text-red-700" onClick={() => setMode('report')}><Flag className="h-4 w-4" />Report</button>}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <textarea className="input min-h-[80px] pb-10" value={text} onChange={(e) => setText(e.target.value)} autoFocus
              aria-label={mode === 'reply' ? 'Reply' : 'Reason for report'}
              placeholder={mode === 'reply' ? 'Your reply goes only to this student, anonymously.' : 'Why should this note be reviewed? The reviewer does not show you the author.'} />
            <ComposeTools value={text} onChange={setText} />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button className={mode === 'reply' ? 'btn-primary' : 'btn-danger'} onClick={submit} disabled={busy || text.trim().length < (mode === 'reply' ? 1 : 3)}>
              {busy ? <Spinner /> : mode === 'reply' ? <Send className="h-4 w-4" /> : <Flag className="h-4 w-4" />}
              {mode === 'reply' ? 'Send reply' : 'Report note'}
            </button>
            <button className="btn-ghost" onClick={() => { setMode('none'); setText(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}
