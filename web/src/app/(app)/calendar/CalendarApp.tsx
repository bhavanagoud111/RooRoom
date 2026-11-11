'use client';
import { LANGUAGES } from '@/lib/languages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import type { DateSelectArg, EventChangeArg, EventClickArg, EventInput } from '@fullcalendar/core';
import {
  AlertTriangle, CalendarPlus, Check, Download, FileText, Mic, MicOff, Send, Sparkles, Trash2, Volume2, X,
} from 'lucide-react';
import { api, Spinner, useConfirm } from '@/components/client';
import { Badge, PageHeader } from '@/components/ui';

const Cal = dynamic(() => import('./Cal'), { ssr: false, loading: () => <div className="flex h-[680px] items-center justify-center"><Spinner /></div> });

type Ev = {
  id: string; title: string; starts_at: string; ends_at: string; kind: 'study' | 'deadline' | 'exam' | 'class';
  source: 'manual' | 'voice' | 'syllabus'; status: 'confirmed' | 'suggested'; weight: string | null;
  course_id: string | null; course_code: string | null; course_title: string | null; color: string | null;
};
type Course = { id: string; code: string; title: string; color: string };
type Clash = { title: string; starts_at: string; ends_at: string };
type Pending =
  | { type: 'create'; input: Draft & { starts_at: string; ends_at: string }; reason: string; overlaps: Clash[] }
  | { type: 'update'; id: string; patch: Record<string, unknown>; reason: string; title: string; overlaps: Clash[] }
  | { type: 'delete'; id: string; reason: string; title: string; starts_at: string };
type Draft = { title: string; kind: Ev['kind']; course_id: string | null };
type Turn = { role: 'user' | 'assistant'; content: string };

const KIND_LABEL: Record<Ev['kind'], string> = { study: 'Study block', deadline: 'Deadline', exam: 'Exam', class: 'Class' };
const SPEECH_LANG: Record<string, string> = {
  en: 'en-US', es: 'es-ES', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR',
  ja: 'ja-JP', ko: 'ko-KR', ur: 'ur-PK', vi: 'vi-VN', ru: 'ru-RU', bn: 'bn-IN', te: 'te-IN', ta: 'ta-IN', ne: 'ne-NP', fa: 'fa-IR', tr: 'tr-TR',
};

const LANG_LABEL: Record<string, string> = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.name]));

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmt = (d: string | Date) => new Date(d).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDay = (d: string | Date) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRec = any;

export function CalendarApp({ name, lang, timezone, role }: { name: string; lang: string; timezone: string; role: string }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Ev[]>([]);
  // Read after mount: the server renders in its own time zone, the browser in the viewer's.
  const [browserTz, setBrowserTz] = useState(timezone);
  const [confirm, confirmDialog] = useConfirm();
  useEffect(() => { setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);

  const load = useCallback(async () => {
    if (!range) return;
    try {
      const r = await api<{ events: Ev[]; courses: Course[] }>(
        `/api/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`);
      setEvents(r.events);
      setCourses(r.courses);
      const s = await api<{ events: Ev[] }>(
        `/api/events?from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 110 * 86400000).toISOString())}`);
      setSuggested(s.events.filter((e) => e.status === 'suggested'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const fcEvents: EventInput[] = useMemo(() => events.map((e) => ({
    id: e.id,
    title: `${e.kind === 'deadline' ? 'Due: ' : e.kind === 'exam' ? 'Exam: ' : ''}${e.course_code ? `${e.course_code.replace(/^[A-Z-]+\s/, '')} · ` : ''}${e.title}`,
    start: e.starts_at,
    end: e.ends_at,
    backgroundColor: e.status === 'suggested' ? '#fff' : (e.color ?? '#475569'),
    textColor: e.status === 'suggested' ? (e.color ?? '#111827') : '#fff',
    classNames: e.status === 'suggested' ? ['rr-suggested'] : [],
    extendedProps: { ev: e },
  })), [events]);

  async function onChange(a: EventChangeArg) {
    const id = a.event.id;
    const patch = { starts_at: a.event.start!.toISOString(), ends_at: (a.event.end ?? a.event.start)!.toISOString() };
    try {
      const r = await api<{ updated: Ev | null; overlaps: Clash[] }>(`/api/events/${id}`, { method: 'PATCH', body: patch });
      if (!r.updated) {
        if (await confirm({ title: 'This overlaps another event', confirmLabel: 'Move anyway',
          body: `It overlaps ${r.overlaps.map((c) => `“${c.title}”`).join(', ')}. Move it anyway?` })) {
          await api(`/api/events/${id}`, { method: 'PATCH', body: { ...patch, force: true } });
        } else a.revert();
      }
    } catch (e) {
      a.revert();
      setErr((e as Error).message);
    }
    load();
  }

  function onSelect(a: DateSelectArg) {
    a.view.calendar.unselect();
    setEditor({ mode: 'new', start: a.start, end: a.end, title: '', kind: 'study', course_id: null });
  }

  function onClick(a: EventClickArg) {
    const e = a.event.extendedProps.ev as Ev;
    setEditor({ mode: 'edit', id: e.id, start: new Date(e.starts_at), end: new Date(e.ends_at), title: e.title, kind: e.kind,
      course_id: e.course_id, status: e.status, source: e.source });
  }

  const suggestedByCourse = useMemo(() => {
    const m = new Map<string, { course: string; color: string; id: string | null; items: Ev[] }>();
    for (const e of suggested) {
      const k = e.course_id ?? 'none';
      if (!m.has(k)) m.set(k, { course: e.course_code ?? 'Other', color: e.color ?? '#475569', id: e.course_id, items: [] });
      m.get(k)!.items.push(e);
    }
    return [...m.values()];
  }, [suggested]);

  async function resolve(action: 'confirm' | 'dismiss', ids?: string[], courseId?: string | null) {
    try {
      await api('/api/events/suggested', { body: { action, ids, courseId: courseId ?? undefined } });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      <PageHeader title="Calendar"
        description={<>Deadlines, exams and study blocks · add by voice
          {browserTz !== timezone && <span className="ml-1 text-gold-700">(Your profile time zone is {timezone}; this screen shows {browserTz}.)</span>}</>}
        actions={<>
          <a href="/api/calendar/ics" className="btn-outline"><Download className="h-4 w-4" />Export .ics</a>
          <button className="btn-primary" onClick={() => {
            const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
            setEditor({ mode: 'new', start: s, end: new Date(s.getTime() + 3600000), title: '', kind: 'study', course_id: null });
          }}><CalendarPlus className="h-4 w-4" />New event</button>
        </>} />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <VoiceAgent lang={lang} onChanged={load} />
          <div className="card p-4">
            <Cal events={fcEvents} onSelect={onSelect} onChange={onChange} onClick={onClick}
              onRange={(from, to) => setRange((r) => (r && +r.from === +from && +r.to === +to ? r : { from, to }))} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-mute">
              <span>Drag across empty time to add an event. Drag or stretch to move it. Click to edit. The New event button opens the same form for keyboard use.</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded bg-slate-500" />Confirmed (course colour)</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded border-[1.5px] border-dashed border-slate-500" />Suggested from a syllabus</span>
            </div>
          </div>
        </div>

        <aside className="grid content-start gap-6 lg:grid-cols-2 2xl:grid-cols-1">
          <TodayCard name={name} lang={lang} refreshKey={events.length} />

          {role === 'student' && (
            <div className="card p-5">
              <h2 className="card-title"><FileText className="h-4 w-4 text-ink-mute" />Syllabus dates to confirm</h2>
              {suggestedByCourse.length === 0 ? (
                <p className="mt-2 text-sm text-ink-mute">No suggestions waiting. When a professor uploads a syllabus, its deadlines and exams appear here for you to confirm.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  <p className="text-xs text-ink-mute">Read from the syllabus by AI. Check each date: a wrong exam date is worse than a missing one.</p>
                  {suggestedByCourse.map((g) => (
                    <div key={g.course}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />{g.course} · {g.items.length}</span>
                        <button className="card-link" onClick={() => resolve('confirm', undefined, g.id)}>Confirm all</button>
                      </div>
                      <ul className="space-y-1.5">
                        {g.items.slice(0, 12).map((e) => (
                          <li key={e.id} className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">{e.title}</p>
                              <p className="text-xs text-ink-mute">{fmtDay(e.starts_at)} · {KIND_LABEL[e.kind]}{e.weight ? ` · ${e.weight}` : ''}</p>
                            </div>
                            <button className="rounded-md p-1 text-emerald-700 hover:bg-emerald-50" onClick={() => resolve('confirm', [e.id])} aria-label={`Confirm ${e.title}`} title="Confirm"><Check className="h-4 w-4" /></button>
                            <button className="rounded-md p-1 text-ink-mute hover:bg-slate-100" onClick={() => resolve('dismiss', [e.id])} aria-label={`Dismiss ${e.title}`} title="Dismiss"><X className="h-4 w-4" /></button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      {editor && <EventEditor state={editor} courses={courses} confirm={confirm} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ today
function TodayCard({ name, lang, refreshKey }: { name: string; lang: string; refreshKey: number }) {
  const [data, setData] = useState<{ summary: string; events: Ev[]; upcoming: Ev[] } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => { api<{ summary: string; events: Ev[]; upcoming: Ev[] }>('/api/calendar/today').then(setData).catch(() => {}); }, [refreshKey]);

  function speak() {
    if (!data || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (speaking) { setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(data.summary);
    u.lang = 'en-US';
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex-col items-start gap-0">
        <p className="eyebrow">Today</p>
        <p className="text-base font-semibold text-ink">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>
      <div className="space-y-3 p-5">
        {!data ? <Spinner /> : (
          <>
            {data.events.length === 0 ? <p className="text-sm text-ink-mute">Nothing on today, {name.split(' ')[0]}.</p> : (
              <ul className="space-y-2">
                {data.events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="mt-1 h-8 w-1 shrink-0 rounded-sm" style={{ background: e.color ?? '#475569' }} />
                    <div>
                      <p className="text-sm font-semibold text-ink">{e.title}</p>
                      <p className="text-xs text-ink-mute">
                        {e.kind === 'deadline' ? `due ${new Date(e.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                          : `${new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${new Date(e.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                        {e.course_code ? ` · ${e.course_code}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.upcoming.length > 0 && (
              <div className="rounded-lg border border-gold-100 bg-gold-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Due this week</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {data.upcoming.slice(0, 4).map((e) => <li key={e.id}>{e.title} <span className="text-ink-mute">· {fmtDay(e.starts_at)}</span></li>)}
                </ul>
              </div>
            )}
            <button className="btn-outline w-full" onClick={speak}>
              <Volume2 className="h-4 w-4" />{speaking ? 'Stop' : 'Read my day aloud'}
            </button>
            {lang !== 'en' && <p className="text-[11px] text-ink-mute">The read-aloud summary is in English for now.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ voice agent
function VoiceAgent({ lang: profileLang, onChanged }: { lang: string; onChanged: () => void }) {
  // Starts at the profile language; the student can switch it here without leaving the page.
  const [lang, setLang] = useState(SPEECH_LANG[profileLang] ? profileLang : 'en');
  useEffect(() => { setLang(SPEECH_LANG[profileLang] ? profileLang : 'en'); }, [profileLang]);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [done, setDone] = useState<{ action: string; event: Ev }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(true);
  const recRef = useRef<SpeechRec>(null);
  const finalRef = useRef('');
  const textRef = useRef('');
  useEffect(() => { textRef.current = text; }, [text]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function say(s: string) {
    if (!speakReplies || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(s);
    u.lang = SPEECH_LANG[lang] ?? 'en-US';
    window.speechSynthesis.speak(u);
  }

  async function submit(input: string) {
    const t = input.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    setDone([]);
    setPending([]);
    try {
      const r = await api<{ reply: string; done: { action: string; event: Ev }[]; pending: Pending[] }>(
        '/api/calendar/agent', { body: { text: t, history: turns.slice(-6) } });
      const reply = r.reply.replace(/\*\*|__|`/g, '').replace(/^\s*[-*]\s+/gm, '• ');
      setTurns((h) => [...h, { role: 'user' as const, content: t }, { role: 'assistant' as const, content: reply }].slice(-8));
      setDone(r.done);
      setPending(r.pending);
      setText('');
      say(reply.replace(/•/g, ''));
      if (r.done.length) onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = SPEECH_LANG[lang] ?? 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    finalRef.current = '';
    rec.onresult = (e: SpeechRec) => {
      let fin = '', mid = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else mid += e.results[i][0].transcript;
      }
      finalRef.current = fin;
      setInterim(mid);
      setText(fin + mid);
    };
    rec.onerror = (e: SpeechRec) => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErr('Microphone access is blocked. Allow the microphone for this site in the address bar, or type instead.');
      else if (e.error === 'no-speech') setErr('I didn’t hear anything. Tap the microphone and speak, or type instead.');
      else if (e.error === 'network') setErr('The browser’s speech service couldn’t be reached. Check your connection, or type instead.');
      else if (e.error === 'language-not-supported') setErr(`Voice input doesn’t support ${LANG_LABEL[lang] ?? lang} in this browser. Pick English under “Speak in”, or type instead.`);
      else if (e.error !== 'aborted') setErr('Voice input isn’t working here. You can type instead.');
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      // Some browsers end without marking the last words final: use whatever was heard.
      const said = (finalRef.current || textRef.current).trim();
      if (said) submit(said);
    };
    recRef.current = rec;
    setErr(null);
    setText('');
    try {
      rec.start();
      setListening(true);
    } catch {
      setErr('Voice input couldn’t start. Reload the page and try again, or type instead.');
    }
  }

  async function confirm(items: Pending[]) {
    setBusy(true);
    try {
      await api('/api/calendar/agent/confirm', {
        body: {
          actions: items.map((p) => (p.type === 'create' ? { type: 'create', input: p.input }
            : p.type === 'update' ? { type: 'update', id: p.id, patch: p.patch } : { type: 'delete', id: p.id })),
        },
      });
      setPending((cur) => cur.filter((p) => !items.includes(p)));
      setTurns((h) => [...h, { role: 'assistant' as const, content: `Confirmed ${items.length} change${items.length > 1 ? 's' : ''}.` }]);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lastReply = [...turns].reverse().find((t) => t.role === 'assistant')?.content;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 border-b border-line p-5">
        <button onClick={toggleMic} disabled={!supported || busy}
          aria-label={listening ? 'Stop listening' : 'Speak a calendar command'} aria-pressed={listening}
          className={clsx('relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition-colors',
            listening ? 'bg-red-600' : 'bg-roo-600 hover:bg-roo-700', (!supported || busy) && 'opacity-60')}>
          {listening && <span className="absolute inset-0 animate-ping rounded-full bg-red-400/50 motion-reduce:hidden" />}
          {supported ? (listening ? <MicOff className="relative h-5 w-5" /> : <Mic className="h-5 w-5" />) : <MicOff className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink" aria-live="polite">{listening ? 'Listening…' : busy ? 'Working on it…' : 'Voice scheduling'}</p>
          <p className="text-sm text-ink-mute">
            {supported ? '“Block 9 to 10 tomorrow for the networks project and add a deadline for HW3 on Friday”'
              : 'Voice input needs Chrome or Edge here. Type your request below instead.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <label className="flex items-center gap-1.5 text-xs text-ink-mute">
            Speak in
            <select className="input h-7 w-auto py-0 pl-2 pr-7 text-xs" value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening}>
              {Object.keys(SPEECH_LANG).map((c) => <option key={c} value={c}>{LANG_LABEL[c] ?? c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-mute">
            <input type="checkbox" className="accent-roo-600" checked={speakReplies} onChange={(e) => setSpeakReplies(e.target.checked)} />
            Speak replies
          </label>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <form onSubmit={(e) => { e.preventDefault(); submit(text); }} className="flex gap-2">
          <input className={clsx('input', interim && 'italic text-ink-soft')} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Or type: “move my networks block to 2pm”, “what do I have on Friday?”" aria-label="Calendar request" maxLength={600} />
          <button className="btn-primary" disabled={busy || !text.trim()} aria-label="Send request">{busy ? <Spinner /> : <Send className="h-4 w-4" />}</button>
        </form>

        {lastReply && (
          <div className="flex gap-2 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-ink" role="status">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-roo-600" /><p dir="auto" className="whitespace-pre-wrap">{lastReply}</p>
          </div>
        )}
        {done.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {done.map((d) => (
              <li key={d.event.id} className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100">
                <Check className="h-3 w-3" />{d.action} · {d.event.title} · {fmt(d.event.starts_at)}
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 && (
          <div className="rounded-lg border border-gold-300 bg-gold-50 p-4" role="alert">
            <p className="flex items-center gap-2 text-sm font-semibold text-gold-700"><AlertTriangle className="h-4 w-4" />Please confirm before I do this</p>
            <ul className="mt-2 space-y-2">
              {pending.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gold-100 bg-white px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {p.type === 'delete' && <><Trash2 className="mr-1 inline h-3.5 w-3.5 text-red-600" />Delete <strong>{p.title}</strong> ({fmt(p.starts_at)})</>}
                    {p.type === 'create' && <>Add <strong>{p.input.title}</strong> ({fmt(p.input.starts_at)}), {p.reason.toLowerCase()}</>}
                    {p.type === 'update' && <>Move <strong>{p.title}</strong>. {p.reason}</>}
                  </span>
                  <button className={p.type === 'delete' ? 'btn-danger btn-sm' : 'btn-primary btn-sm'} disabled={busy} onClick={() => confirm([p])}>{p.type === 'delete' ? 'Delete' : 'Book anyway'}</button>
                  <button className="btn-ghost btn-sm" onClick={() => setPending((cur) => cur.filter((x) => x !== p))}>Cancel</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor (also the accessible form)
type EditorState = {
  mode: 'new' | 'edit'; id?: string; start: Date; end: Date; title: string; kind: Ev['kind']; course_id: string | null;
  status?: Ev['status']; source?: Ev['source'];
};

function EventEditor({ state, courses, confirm, onClose, onSaved }: {
  state: EditorState; courses: Course[]; onClose: () => void; onSaved: () => void;
  confirm: (o: { title: string; body?: React.ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    title: state.title, kind: state.kind, course_id: state.course_id ?? '',
    date: toDateInput(state.start), start: toTimeInput(state.start), end: toTimeInput(state.end),
  });
  const [clash, setClash] = useState<Clash[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function save(force = false) {
    setBusy(true);
    setErr(null);
    const s = new Date(`${f.date}T${f.start}`);
    let e = new Date(`${f.date}T${f.end}`);
    if (f.kind === 'deadline' && e <= s) e = new Date(s.getTime() + 30 * 60000);
    const payload = { title: f.title.trim(), kind: f.kind, course_id: f.course_id || null, starts_at: s.toISOString(), ends_at: e.toISOString(), force };
    try {
      const r = state.mode === 'new'
        ? await api<{ created: Ev | null; overlaps: Clash[] }>('/api/events', { body: payload })
        : await api<{ updated: Ev | null; overlaps: Clash[] }>(`/api/events/${state.id}`, { method: 'PATCH', body: payload });
      const ok = 'created' in r ? r.created : (r as { updated: Ev | null }).updated;
      if (!ok) { setClash(r.overlaps); setBusy(false); return; }
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Delete this event?', body: `“${state.title}” will be removed from your calendar.`, confirmLabel: 'Delete', danger: true }))) return;
    setBusy(true);
    try {
      await api(`/api/events/${state.id}`, { method: 'DELETE' });
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-labelledby="ev-title" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); save(false); }} className="card w-full max-w-md space-y-3 p-6">
        <div className="flex items-start justify-between">
          <h2 id="ev-title" className="text-lg font-semibold">{state.mode === 'new' ? 'New event' : 'Edit event'}</h2>
          <button type="button" className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {state.status === 'suggested' && (
          <p className="rounded-lg border border-roo-100 bg-roo-50 px-3 py-2 text-xs text-roo-800">Suggested from the syllabus. Saving confirms it.</p>
        )}
        {state.source && state.mode === 'edit' && <Badge tone="gray">Added by {state.source === 'voice' ? 'voice' : state.source === 'syllabus' ? 'syllabus' : 'hand'}</Badge>}
        <div>
          <label className="label" htmlFor="ev-t">Title</label>
          <input id="ev-t" ref={firstRef} className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Networks project" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="ev-k">Type</label>
            <select id="ev-k" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Ev['kind'] })}>
              <option value="study">Study block</option><option value="deadline">Deadline</option>
              <option value="exam">Exam</option><option value="class">Class</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ev-c">Course</label>
            <select id="ev-c" className="input" value={f.course_id} onChange={(e) => setF({ ...f, course_id: e.target.value })}>
              <option value="">None</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 sm:col-span-1">
            <label className="label" htmlFor="ev-d">Date</label>
            <input id="ev-d" type="date" className="input" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ev-s">{f.kind === 'deadline' ? 'Due' : 'Start'}</label>
            <input id="ev-s" type="time" className="input" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ev-e">End</label>
            <input id="ev-e" type="time" className="input" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          </div>
        </div>
        {clash && (
          <div className="rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm text-gold-700" role="alert">
            <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />This overlaps</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{clash.map((c, i) => <li key={i}>{c.title}, {fmt(c.starts_at)}</li>)}</ul>
            <button type="button" className="btn-primary btn-sm mt-2" disabled={busy} onClick={() => save(true)}>Book anyway</button>
          </div>
        )}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button className="btn-primary" disabled={busy || !f.title.trim()}>{busy && <Spinner />}{state.status === 'suggested' ? 'Confirm' : 'Save'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          {state.mode === 'edit' && (
            <button type="button" className="btn-danger ml-auto" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" />Delete</button>
          )}
        </div>
      </form>
    </div>
  );
}
