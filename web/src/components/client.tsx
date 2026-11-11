'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Languages, Loader2 } from 'lucide-react';

/** fetch wrapper for our JSON API. Throws with the server's plain-English message. */
export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * Translate-on-tap. Shows the translation with the original one tap away,
 * because translation of technical terms is a known risk.
 */
export function Translatable({ text, kind, lang, className, cache = false }: {
  text: string;
  kind: 'question' | 'answer' | 'message' | 'note' | 'study' | 'flashcard';
  lang: string;
  className?: string;
  cache?: boolean;
}) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [showing, setShowing] = useState<'original' | 'translated'>('original');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (translated) {
      setShowing(showing === 'original' ? 'translated' : 'original');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ text: string }>('/api/translate', { body: { text, kind, target: lang, cache } });
      setTranslated(r.text);
      setShowing('translated');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="whitespace-pre-wrap" dir="auto">{showing === 'translated' && translated ? translated : text}</div>
      {lang !== 'en' || translated ? (
        <button onClick={go} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-roo-600 hover:underline" type="button">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
          {showing === 'translated' ? 'Show original' : 'Translate'}
        </button>
      ) : null}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className ?? ''}`} />;
}

type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };

/**
 * ConfirmationDialog as a hook: `const [confirm, dialog] = useConfirm();` then
 * `if (!(await confirm({ title: 'Delete?' }))) return;` and render `{dialog}` once.
 * Uses the native <dialog> element, so focus is trapped and Escape cancels.
 */
export function useConfirm(): [(o: ConfirmOpts) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  useEffect(() => {
    if (opts && ref.current && !ref.current.open) ref.current.showModal();
  }, [opts]);

  const close = (v: boolean) => {
    ref.current?.close();
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const dialog = opts ? (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); close(false); }} aria-labelledby="rr-confirm-title"
      className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line p-0 shadow-lift backdrop:bg-slate-900/40">
      <div className="p-5">
        <h2 id="rr-confirm-title" className="text-base font-semibold text-ink">{opts.title}</h2>
        {opts.body && <div className="mt-2 text-sm text-ink-mute">{opts.body}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-3">
        <button type="button" className="btn-outline" onClick={() => close(false)} autoFocus>Cancel</button>
        <button type="button" className={opts.danger ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'} onClick={() => close(true)}>
          {opts.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </dialog>
  ) : null;

  return [confirm, dialog];
}
