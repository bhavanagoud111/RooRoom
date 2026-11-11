'use client';
// "Summarize" button for the professor: runs the Summarize agent over all anonymous questions or
// all delivered feedback, and shows the most common themes.
import { useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { Markdown } from '@/components/Markdown';

export function SummarizeButton({ courseId, kind, count }: { courseId: string; kind: 'questions' | 'feedback'; count: number }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ summary: string; count: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    try { setOut(await api(`/api/courses/${courseId}/summarize`, { body: { kind } })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <button className="btn-primary" onClick={run} disabled={busy || count === 0}>
        {busy ? <Spinner /> : out ? <RotateCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        {busy ? `Summarizing ${count} ${kind}…` : out ? 'Summarize again' : `Summarize ${kind === 'questions' ? 'all questions' : 'all feedback'}`}
      </button>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      {out && (
        <div className="rounded-xl border border-roo-100 bg-roo-50/40 p-5" aria-live="polite">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-roo-700">
            <Sparkles className="h-3.5 w-3.5" />Summarize agent · {out.count} {kind}
          </p>
          <Markdown text={out.summary} />
        </div>
      )}
    </div>
  );
}
