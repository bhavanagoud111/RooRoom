'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Globe2, Lock, Trash2, Upload } from 'lucide-react';
import { api, Spinner, useConfirm } from '@/components/client';
import { Badge, Empty, LoadingSkeleton, PageHeader } from '@/components/ui';
import { TAGS } from '../tags';

type Doc = {
  id: string; title: string; kind: string; module: string | null; visibility: 'class' | 'private';
  filename: string; size_bytes: number; status: string; status_note: string | null; page_count: number | null;
  created_at: string; mine: boolean; author_role: string;
};

const KIND_LABEL: Record<string, string> = { module: 'Module', syllabus: 'Syllabus', assignment: 'Assignment', quiz: 'Quiz' };

export function Materials({ courseId, isProf }: { courseId: string; isProf: boolean }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: '', kind: 'module', module: '', visibility: isProf ? 'class' : 'private' });
  const [kindFilter, setKindFilter] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  const shown = useMemo(() => (docs ?? []).filter((d) => !kindFilter || d.kind === kindFilter), [docs, kindFilter]);

  const load = useCallback(() => {
    api<{ documents: Doc[] }>(`/api/courses/${courseId}/documents`).then((r) => setDocs(r.documents)).catch((e) => setErr(e.message));
  }, [courseId]);

  useEffect(load, [load]);
  // Poll while anything is still being read by the worker.
  useEffect(() => {
    if (!docs?.some((d) => d.status === 'pending' || d.status === 'processing')) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [docs, load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr('Choose a PDF first.');
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set('file', file);
    Object.entries(form).forEach(([k, v]) => fd.set(k, v));
    try {
      const res = await fetch(`/api/courses/${courseId}/documents`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm({ ...form, title: '', module: '' });
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const d = docs?.find((x) => x.id === id);
    if (!(await confirm({ title: 'Delete this file?', body: `“${d?.title ?? 'This file'}” and its index will be removed for good. This can’t be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    await api(`/api/documents/${id}`, { method: 'DELETE' }).catch((e) => setErr(e.message));
    load();
  }

  return (
    <div>
    {confirmDialog}
    <PageHeader title="Materials & Syllabus"
      description={TAGS.materials} />
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="card h-fit overflow-hidden" aria-labelledby="files">
        <div className="card-header">
          <h2 id="files" className="card-title"><FileText className="h-4 w-4 text-ink-mute" />Files{docs ? <span className="font-normal text-ink-mute">· {shown.length}</span> : null}</h2>
          <select className="input h-8 w-auto py-0 text-xs" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {docs === null ? <div className="p-5"><LoadingSkeleton rows={3} /></div> : shown.length === 0 ? (
          <div className="p-5"><Empty icon={<FileText />} title={kindFilter ? 'No files of this type' : 'No materials yet'}>
            {isProf ? 'Upload your syllabus first: its deadlines go straight onto every student’s calendar.'
              : 'Your professor has not uploaded anything yet. You can add your own private notes.'}
          </Empty></div>
        ) : <ul className="divide-y divide-line">{shown.map((d) => (
          <li key={d.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${d.kind === 'syllabus' ? 'bg-roo-50 text-roo-600' : 'bg-slate-100 text-ink-mute'}`}>
              <FileText className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{d.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                <Badge tone={d.kind === 'syllabus' ? 'blue' : d.kind === 'module' ? 'gray' : 'gold'}>{KIND_LABEL[d.kind]}</Badge>
                {d.module && <Badge>{d.module}</Badge>}
                {d.visibility === 'class'
                  ? <Badge tone="green"><Globe2 className="h-3 w-3" />Whole class</Badge>
                  : <Badge tone="gray"><Lock className="h-3 w-3" />Only you</Badge>}
                {d.page_count ? <span>{d.page_count} pages</span> : null}
                <span>{(d.size_bytes / 1024).toFixed(0)} KB</span>
              </div>
              <Status d={d} />
            </div>
            <a href={`/api/documents/${d.id}`} className="btn-ghost h-8 w-8 px-0" title="Download" aria-label={`Download ${d.title}`}>
              <Download className="h-4 w-4" />
            </a>
            {d.mine && (
              <button className="btn-ghost h-8 w-8 px-0 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => remove(d.id)} aria-label={`Delete ${d.title}`} title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}</ul>}
      </section>

      <form onSubmit={upload} className="card h-fit space-y-3 p-5">
        <h2 className="card-title"><Upload className="h-4 w-4 text-ink-mute" />Upload a PDF</h2>
        <input ref={fileRef} type="file" accept="application/pdf" className="block w-full text-sm text-ink-soft file:mr-3 file:h-9 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-slate-50" aria-label="PDF file" />
        <div>
          <label className="label" htmlFor="t">Title</label>
          <input id="t" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Module 3: Transport layer" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="k">Type</label>
            <select id="k" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="module">Module</option>
              {isProf && <option value="syllabus">Syllabus</option>}
              <option value="assignment">Assignment</option>
              <option value="quiz">Quiz</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="m">Module</label>
            <input id="m" className="input" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} placeholder="Module 3" />
          </div>
        </div>
        {isProf ? (
          <div>
            <label className="label" htmlFor="v">Who can see it</label>
            <select id="v" className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="class">The whole class</option>
              <option value="private">Only me</option>
            </select>
          </div>
        ) : null}
        {form.kind === 'syllabus' && (
          <p className="rounded-lg border border-roo-100 bg-roo-50 px-3 py-2 text-xs text-roo-800">
            Deadlines and exams in the syllabus will be suggested on every enrolled student’s calendar.
          </p>
        )}
        {(form.kind === 'assignment' || form.kind === 'quiz') && (
          <p className="rounded-lg border border-gold-100 bg-gold-50 px-3 py-2 text-xs text-gold-700">
            Graded work: the Study AI switches to hints only when a question is close to this text.
          </p>
        )}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Upload</button>
      </form>
    </div>
    </div>
  );
}

function Status({ d }: { d: Doc }) {
  if (d.status === 'ready') {
    return <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" />{d.status_note ?? 'Ready'}</p>;
  }
  if (d.status === 'pending' || d.status === 'processing') {
    return <p className="mt-1 flex items-center gap-1 text-xs text-roo-600"><Spinner className="h-3 w-3" />Reading and indexing…</p>;
  }
  return <p className="mt-1 flex items-center gap-1 text-xs text-gold-700"><AlertTriangle className="h-3 w-3" />{d.status_note ?? 'Could not read this file.'}</p>;
}
