'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Spinner } from '@/components/client';
import { When } from '../ask/When';

type S = { clusterThreshold: number; similarityCutoff: number; notesEnabled: boolean; notesWeeklyLimit: number; mutedUntil: string | null };

export function SettingsForm({ courseId, initial }: { courseId: string; initial: S }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/courses/${courseId}/course-settings`, {
        method: 'PATCH',
        body: { clusterThreshold: s.clusterThreshold, similarityCutoff: s.similarityCutoff, notesEnabled: s.notesEnabled, notesWeeklyLimit: s.notesWeeklyLimit, ...extra },
      });
      setMsg({ ok: true, text: 'Saved.' });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-5 p-5">
        <h2 className="text-base font-semibold text-ink">Question pool</h2>
        <div>
          <label className="label" htmlFor="th">Privacy threshold: {s.clusterThreshold} students</label>
          <input id="th" type="range" min={2} max={10} value={s.clusterThreshold} className="w-full accent-roo-500"
            onChange={(e) => setS({ ...s, clusterThreshold: Number(e.target.value) })} />
          <p className="mt-1 text-xs text-ink-mute">
            You see a group of similar questions only once this many different students have asked. This is what lets a student
            ask something embarrassing without being identifiable, so lower values mean weaker anonymity.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="sim">How similar questions must be to group: {Math.round(s.similarityCutoff * 100)}%</label>
          <input id="sim" type="range" min={0.6} max={0.95} step={0.01} value={s.similarityCutoff} className="w-full accent-roo-500"
            onChange={(e) => setS({ ...s, similarityCutoff: Number(e.target.value) })} />
          <p className="mt-1 text-xs text-ink-mute">Higher means tighter, more specific groups. Lower merges more questions together.</p>
        </div>
      </section>
      <section className="card space-y-5 p-5">
        <h2 className="text-base font-semibold text-ink">Anonymous feedback</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink">Accept anonymous notes</span>
          <input type="checkbox" className="h-5 w-5 accent-roo-500" checked={s.notesEnabled} onChange={(e) => setS({ ...s, notesEnabled: e.target.checked })} />
        </label>
        <div>
          <label className="label" htmlFor="wl">Notes per student per week: {s.notesWeeklyLimit}</label>
          <input id="wl" type="range" min={1} max={10} value={s.notesWeeklyLimit} className="w-full accent-roo-500"
            onChange={(e) => setS({ ...s, notesWeeklyLimit: Number(e.target.value) })} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm">
          <span>{s.mutedUntil ? <>Muted until <When iso={s.mutedUntil} mode="date" /></> : 'Not muted'}</span>
          <button type="button" className="btn-outline btn-sm" disabled={busy}
            onClick={() => save({ muteWeek: !s.mutedUntil }).then(() => setS({ ...s, mutedUntil: s.mutedUntil ? null : new Date(Date.now() + 7 * 864e5).toISOString() }))}>
            {s.mutedUntil ? 'Unmute' : 'Mute for a week'}
          </button>
        </div>
      </section>
      <div className="flex items-center gap-3 lg:col-span-2">
        <button className="btn-primary" onClick={() => save()} disabled={busy}>{busy && <Spinner />}Save settings</button>
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'} role="status">{msg.text}</span>}
      </div>
    </div>
  );
}
