'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Clock, GraduationCap, Plus, Search, UserRound } from 'lucide-react';
import { api, Spinner } from '@/components/client';
import { ComposeTools } from '@/components/ComposeTools';

type Section = { section: string; component: string; days_times: string; class_nbr: string };
type Room = {
  id: string; professor: string | null; on_rooroom: boolean; source: string; class_size: number;
  enrolled: boolean; sections: Section[];
};
type Course = {
  code: string; subject: string; number: string; title: string; credits: string | null; description: string | null;
  prerequisites: string | null; level: string | null; subject_name: string | null; rooms: Room[];
};
type Subject = { subject: string; name: string | null; courses: number; offered: number };

export function CourseSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [level, setLevel] = useState('');
  const [offered, setOffered] = useState(true);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<Course[] | null>(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ subjects: Subject[]; term: string }>('/api/courses?subjects=1')
      .then((r) => { setSubjects(r.subjects); setTerm(r.term); }).catch(() => {});
  }, []);

  const params = useMemo(() => new URLSearchParams({ q, subject, level, offered: offered ? '1' : '0' }).toString(), [q, subject, level, offered]);

  useEffect(() => {
    setPage(0);
    const t = setTimeout(() => {
      api<{ courses: Course[]; more: boolean }>(`/api/courses?${params}&page=0`)
        .then((r) => { setRows(r.courses); setMore(r.more); }).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [params]);

  async function loadMore() {
    const next = page + 1;
    const r = await api<{ courses: Course[]; more: boolean }>(`/api/courses?${params}&page=${next}`);
    setRows((prev) => [...(prev ?? []), ...r.courses]);
    setMore(r.more);
    setPage(next);
  }

  async function join(roomId: string) {
    setBusy(roomId);
    setErr(null);
    try {
      await api(`/api/courses/${roomId}/enroll`, { body: {} });
      router.push(`/c/${roomId}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  async function openRoom(code: string) {
    setBusy(code);
    setErr(null);
    try {
      const r = await api<{ id: string }>('/api/catalog/room', { body: { code } });
      await join(r.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  const totalCourses = subjects.reduce((n, s) => n + s.courses, 0);

  return (
    <div className="card p-4 sm:p-5">
      <div className="grid gap-2 sm:grid-cols-[1fr_220px_170px]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" />
          <input className="input pl-9 pr-20" placeholder="Course code, title or topic: “COMP-SCI 5520”, “organic chemistry”, “nursing ethics”"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the UMKC catalog" />
          <ComposeTools value={q} onChange={setQ} className="!bottom-0.5" />
        </div>
        <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
          <option value="">All subjects ({subjects.length})</option>
          {subjects.map((s) => (
            <option key={s.subject} value={s.subject}>{s.subject}{s.name ? ` · ${s.name}` : ''} ({s.courses})</option>
          ))}
        </select>
        <select className="input" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
          <option value="">All levels</option>
          <option value="undergraduate">Undergraduate</option>
          <option value="graduate">Graduate</option>
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-mute">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={offered} onChange={(e) => setOffered(e.target.checked)} className="accent-roo-500" />
          Only courses on the {term || 'current'} schedule
        </label>
        <span>{totalCourses.toLocaleString()} courses from the UMKC catalog · professors from the public {term} class schedule</span>
      </div>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}

      <ul className="mt-4 space-y-3">
        {rows === null && <li className="flex justify-center py-6"><Spinner /></li>}
        {rows?.length === 0 && <li className="py-6 text-center text-sm text-ink-mute">No courses match. Try fewer words or untick the schedule filter.</li>}
        {rows?.map((c) => <CourseRow key={c.code} c={c} term={term} busy={busy} onJoin={join} onOpen={openRoom} />)}
      </ul>
      {more && (
        <button className="btn-outline mt-3 w-full" onClick={loadMore}><ChevronDown className="h-4 w-4" />Show more courses</button>
      )}
    </div>
  );
}

function CourseRow({ c, term, busy, onJoin, onOpen }: {
  c: Course; term: string; busy: string | null; onJoin: (id: string) => void; onOpen: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const enrolledRoom = c.rooms.find((r) => r.enrolled);
  const scheduled = c.rooms.filter((r) => r.source !== 'umkc_catalog');
  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-roo-600">
            {c.code}{c.credits ? ` · ${c.credits} credits` : ''}{c.level ? ` · ${c.level}` : ''}
          </p>
          <p className="text-base font-semibold text-ink">{c.title}</p>
          {c.subject_name && <p className="text-xs text-ink-mute">{c.subject_name}</p>}
        </div>
        {enrolledRoom && <span className="chip bg-emerald-50 text-emerald-700"><Check className="h-3 w-3" />Joined</span>}
      </div>
      {c.description && (
        <p className={`mt-2 text-sm text-ink-soft ${open ? '' : 'line-clamp-2'}`}>
          {c.description}
          {open && c.prerequisites && <span className="mt-1 block text-xs text-ink-mute">Prerequisites: {c.prerequisites}</span>}
        </p>
      )}
      {c.description && c.description.length > 160 && (
        <button className="mt-1 text-xs font-semibold text-roo-600 hover:underline" onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}

      <div className="mt-3">
        {scheduled.length > 0 ? (
          <>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-mute">
              <GraduationCap className="h-3.5 w-3.5" />Choose your professor · {term}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {scheduled.map((r) => (
                <div key={r.id} className={`rounded-lg border p-3 ${r.enrolled ? 'border-emerald-300 bg-emerald-50/50' : 'border-line'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <UserRound className="h-3.5 w-3.5 text-roo-500" />{r.professor ?? 'Instructor not announced yet'}
                      </p>
                      <p className="text-[11px] text-ink-mute">
                        {r.source === 'demo' ? 'Demo room' : r.on_rooroom ? 'On RooRoom' : 'Not on RooRoom yet'} · {r.class_size} joined
                      </p>
                    </div>
                    {r.enrolled ? (
                      <a href={`/c/${r.id}`} className="btn-outline px-3 py-1 text-xs">Open</a>
                    ) : (
                      <button className="btn-primary px-3 py-1 text-xs" disabled={busy === r.id} onClick={() => onJoin(r.id)}>
                        {busy === r.id ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        {enrolledRoom ? 'Switch' : 'Join'}
                      </button>
                    )}
                  </div>
                  {r.sections.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {r.sections.slice(0, 4).map((s) => (
                        <li key={s.class_nbr} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                          <Clock className="h-3 w-3 text-ink-mute" />
                          <span className="font-medium">{s.component} {s.section}</span>
                          <span className="text-ink-mute">{s.days_times || 'Time to be announced'}</span>
                        </li>
                      ))}
                      {r.sections.length > 4 && <li className="text-[11px] text-ink-mute">+{r.sections.length - 4} more sections</li>}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2">
            <p className="text-xs text-ink-mute">Not on the {term} class schedule. You can still open a room for classmates; no professor yet.</p>
            {enrolledRoom ? (
              <a href={`/c/${enrolledRoom.id}`} className="btn-outline px-3 py-1 text-xs">Open</a>
            ) : (
              <button className="btn-outline px-3 py-1 text-xs" disabled={busy === c.code} onClick={() => onOpen(c.code)}>
                {busy === c.code ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3" />}Join room
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
