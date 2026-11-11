'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api, Spinner } from '@/components/client';

import { LANGUAGES } from '@/lib/languages';

type Me = {
  id: string; display_name: string; role: 'student' | 'professor'; preferred_language: string;
  timezone: string; visible_to_classmates: boolean;
};

export function ProfileForm({ me }: { me: Me }) {
  const router = useRouter();
  const [f, setF] = useState({
    displayName: me.display_name, preferredLanguage: me.preferred_language,
    timezone: me.timezone, visibleToClassmates: me.visible_to_classmates,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = useMemo(() => {
    try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone'); }
    catch { return [me.timezone]; }
  }, [me.timezone]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api('/api/me', { method: 'PATCH', body: f });
      setMsg({ ok: true, text: 'Saved.' });
      router.refresh();
    } catch (x) {
      setMsg({ ok: false, text: (x as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card grid gap-5 p-6 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="dn">Display name</label>
        <input id="dn" className="input" maxLength={60} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required />
        <p className="mt-1 text-xs text-ink-mute">Your email address is never shown to anyone.</p>
      </div>
      <div>
        <label className="label" htmlFor="lang">Preferred language</label>
        <select id="lang" className="input" value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native} · {l.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-ink-mute">Study AI answers, professor announcements and translations use this language. The English original is always one tap away.</p>
      </div>
      <div>
        <label className="label" htmlFor="tz">Time zone</label>
        <select id="tz" className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
        <p className="mt-1 text-xs text-ink-mute">The voice calendar resolves “Friday at 9” in this zone.</p>
      </div>
      {me.role === 'student' && (
        <div>
          <span className="label">Study buddies</span>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:border-roo-300">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-roo-500" checked={f.visibleToClassmates}
              onChange={(e) => setF({ ...f, visibleToClassmates: e.target.checked })} />
            <span className="text-sm">
              <strong className="block text-ink">Visible to classmates</strong>
              <span className="text-ink-mute">Classmates in your courses can see your display name, what you’re studying and when you’re free, and message you. Off by default.</span>
            </span>
          </label>
        </div>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save changes</button>
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}
