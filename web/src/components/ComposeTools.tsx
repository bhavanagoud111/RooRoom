'use client';
// The two helpers next to every text box: "Translate to English" (rewrite what you typed, in any
// language, into English before you send it, with Undo) and the voice-typing mic.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Languages, Undo2 } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { VoiceButton } from '@/components/VoiceButton';

export function TranslateToEnglish({ value, onChange, variant = 'button' }: {
  value: string; onChange: (v: string) => void; variant?: 'inline' | 'button';
}) {
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ original: string; english: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // Once the person edits the English, Undo no longer applies.
  useEffect(() => { if (undo && value !== undo.english) setUndo(null); }, [value, undo]);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 5000); return () => clearTimeout(t); }, [err]);

  async function run() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ text: string }>('/api/translate', { body: { text, kind: 'draft', target: 'en' } });
      if (!mounted.current) return;
      if (r.text.trim() === text) { setErr('This already looks like English.'); return; }
      onChange(r.text);
      setUndo({ original: value, english: r.text });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const small = variant === 'inline';
  const base = clsx('relative flex items-center justify-center rounded-lg transition-colors',
    small ? 'h-8 w-8 text-ink-mute hover:bg-slate-100 hover:text-roo-600' : 'h-[42px] w-[42px] border border-line bg-white text-ink-soft hover:bg-slate-50 hover:text-roo-600');
  return (
    <span className="relative inline-flex shrink-0 items-center gap-0.5">
      {undo ? (
        <button type="button" className={base} onClick={() => { onChange(undo.original); setUndo(null); }}
          title="Undo: put back what you typed" aria-label="Undo translation">
          <Undo2 className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" className={clsx(base, !value.trim() && 'opacity-40')} onClick={run} disabled={busy || !value.trim()}
          title="Translate what you typed into English" aria-label="Translate to English">
          {busy ? <Spinner /> : <Languages className="h-4 w-4" />}
        </button>
      )}
      {(err || undo) && (
        <span role={err ? 'alert' : 'status'}
          className={clsx('absolute bottom-full right-0 z-20 mb-1 w-max max-w-[14rem] rounded-md px-2.5 py-1.5 text-left text-xs shadow-lift',
            err ? 'bg-slate-900 text-white' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200')}>
          {err ?? 'Translated to English. Check it, then send.'}
        </span>
      )}
    </span>
  );
}

/**
 * Translate + mic for a text box. placement "inside" pins them to the bottom-right corner of the
 * box (the wrapper must be `relative`, and the box needs right padding, e.g. pr-20);
 * "beside" puts full-size buttons next to it, as in the chat composers.
 */
export function ComposeTools({ value, onChange, placement = 'inside', className }: {
  value: string; onChange: (v: string) => void; placement?: 'inside' | 'beside'; className?: string;
}) {
  const v = placement === 'inside' ? 'inline' : 'button';
  return (
    <span className={clsx(placement === 'inside' ? 'absolute bottom-1.5 right-1.5 flex items-center gap-0.5' : 'flex shrink-0 items-end gap-2', className)}>
      <TranslateToEnglish value={value} onChange={onChange} variant={v} />
      <VoiceButton value={value} onChange={onChange} variant={v} />
    </span>
  );
}
