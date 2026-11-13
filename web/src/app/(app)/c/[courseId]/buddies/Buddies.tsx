'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  ArrowLeft, Ban, BookOpen, CalendarClock, Download, FileText, Flag, LogOut, MessageCircle, Paperclip, Search, Send, ShieldCheck, Sparkles, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { api, Spinner, Translatable, useConfirm } from '@/components/client';
import { Badge, Empty, LoadingSkeleton, PageHeader, timeAgo } from '@/components/ui';
import { TAGS } from '../tags';
import { ComposeTools } from '@/components/ComposeTools';

type Slot = { start: string; end: string; label: string };
type Buddy = {
  id: string; display_name: string; activity_line: string | null; activity_at: string | null;
  free: Slot[]; thread_id: string | null; blocked: boolean;
};
type ThreadSummary = { id: string; is_group: boolean; title: string | null; members: { id: string; display_name: string }[]; last_at: string | null };
type Member = { id: string; display_name: string; blocked: boolean };
type Thread = { id: string; course_id: string; is_group: boolean; title: string | null; blocked: boolean; members: Member[] };
type Attachment = { id: string; filename: string; content_type: string; size_bytes: number };
type Msg = { id: string; sender_id: string; sender_name: string; mine: boolean; body: string; created_at: string; attachments?: Attachment[] };

// What can be shared in chat (the server checks the file's real contents too).
const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.zip,.txt,.csv,.md';
const MAX_FILE = 10 * 1024 * 1024;
const isImage = (t: string) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(t);
const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function AttachmentView({ a, mine }: { a: Attachment; mine: boolean }) {
  const url = `/api/attachments/${a.id}`;
  if (isImage(a.content_type)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={a.filename} loading="lazy" className="max-h-64 max-w-full rounded-md bg-white object-contain" />
      </a>
    );
  }
  return (
    <a href={`${url}?download=1`} className={clsx('mb-1 flex items-center gap-2.5 rounded-md px-2.5 py-2',
      mine ? 'bg-white/15 hover:bg-white/25' : 'bg-slate-50 ring-1 ring-inset ring-line hover:bg-slate-100')}>
      <FileText className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{a.filename}</span>
        <span className={clsx('block text-[11px]', mine ? 'text-roo-100' : 'text-ink-mute')}>{fmtSize(a.size_bytes)}</span>
      </span>
      <Download className="h-4 w-4 shrink-0" aria-label="Download" />
    </a>
  );
}
type Me = { id: string; name: string; lang: string };

const COLORS = ['#1D4ED8', '#0F766E', '#B45309', '#475569', '#9D174D', '#0E7490', '#3F6212', '#6D28D9'];
const colorFor = (id: string) => COLORS[parseInt(id.slice(0, 2), 16) % COLORS.length];

function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.4 }} aria-hidden>
      {name.slice(0, 1)}
    </span>
  );
}

// ------------------------------------------------------------------ live connection
function useChatSocket(onMessage: (threadId: string) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const joined = useRef<Set<string>>(new Set());
  const cb = useRef(onMessage);
  cb.current = onMessage;
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval> | undefined;
    async function connect() {
      if (stopped) return;
      setStatus('connecting');
      try {
        const { ticket } = await api<{ ticket: string }>('/api/chat/ticket');
        const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;
        ws.onopen = () => {
          retry = 0;
          setStatus('live');
          joined.current.forEach((t) => ws.send(JSON.stringify({ type: 'join', thread_id: t })));
          ping = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 20000);
        };
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data);
            if (m.type === 'message') cb.current(m.thread_id);
          } catch { /* ignore */ }
        };
        ws.onclose = () => {
          clearInterval(ping);
          setStatus('offline');
          if (!stopped) setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
        };
      } catch {
        setStatus('offline');
        if (!stopped) setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
      }
    }
    connect();
    return () => {
      stopped = true;
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, []);

  const join = useCallback((threadId: string) => {
    joined.current.add(threadId);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'join', thread_id: threadId }));
  }, []);

  return { status, join };
}

// ------------------------------------------------------------------ page
export function Buddies({ courseId, courseColor, me, initialThread }: {
  courseId: string; courseColor: string; me: Me; initialThread: string | null;
}) {
  const [data, setData] = useState<{ visible: boolean; buddies: Buddy[]; threads: ThreadSummary[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(initialThread);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const activeRef = useRef(active);
  activeRef.current = active;
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api<{ visible: boolean; buddies: Buddy[]; threads: ThreadSummary[] }>(`/api/courses/${courseId}/buddies`)
      .then(setData).catch((e) => setErr(e.message));
  }, [courseId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const { status, join } = useChatSocket((threadId) => {
    if (threadId === activeRef.current) setTick((t) => t + 1);
    else setUnread((u) => new Set(u).add(threadId));
  });

  useEffect(() => { data?.threads.forEach((t) => join(t.id)); }, [data, join]);
  useEffect(() => { if (active) join(active); }, [active, join]);

  async function openThread(memberIds: string[], title = '', group = false) {
    setBusy(memberIds.join(','));
    setErr(null);
    try {
      const r = await api<{ id: string }>('/api/threads', { body: { courseId, memberIds, title, group } });
      setActive(r.id);
      setPicking(false);
      setPicked([]);
      setGroupTitle('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const studyingNow = useMemo(() => data?.buddies.filter((b) => b.activity_line).length ?? 0, [data]);
  const [filter, setFilter] = useState('');
  const shownBuddies = useMemo(() => {
    const t = filter.trim().toLowerCase();
    const all = data?.buddies ?? [];
    return t ? all.filter((b) => b.display_name.toLowerCase().includes(t) || (b.activity_line ?? '').toLowerCase().includes(t)) : all;
  }, [data, filter]);

  const header = (
    <PageHeader title="Study Buddies"
      description={TAGS.buddies} />
  );
  if (!data) return <div>{header}{err ? <p className="text-red-600" role="alert">{err}</p> : <div className="card p-5"><LoadingSkeleton rows={4} /></div>}</div>;

  return (
    <div>
    {header}
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className={clsx('space-y-4', active && 'hidden xl:block')}>
        {!data.visible && (
          <div className="rounded-xl border border-gold-100 bg-gold-50 p-4 text-sm" role="note">
            <p className="font-semibold text-ink">You’re hidden from classmates</p>
            <p className="mt-1 text-ink-soft">You can see who’s studying, but to start a chat (and appear here) turn on
              “visible to classmates”.</p>
            <Link href="/settings" className="btn-outline btn-sm mt-3">Open settings</Link>
          </div>
        )}

        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="card-title"><Users className="h-4 w-4 text-ink-mute" />Classmate directory</h2>
              <p className="text-xs text-ink-mute">{data.buddies.length} visible · {studyingNow} studying this week</p>
            </div>
            {data.visible && (
              <button className={picking ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'} disabled={!picking && data.buddies.length === 0}
                title={data.buddies.length === 0 ? 'No classmates in this course are visible yet' : undefined}
                onClick={() => { setPicking(!picking); setPicked([]); }}>
                {picking ? 'Cancel' : <><Users className="h-4 w-4" />New group chat</>}
              </button>
            )}
          </div>

          {data.buddies.length > 3 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" aria-hidden />
              <input type="search" className="input pl-9 pr-20" placeholder="Search by name or topic" value={filter}
                onChange={(e) => setFilter(e.target.value)} aria-label="Search classmates" />
              <ComposeTools value={filter} onChange={setFilter} className="!bottom-0.5" />
            </div>
          )}
          {picking && (
            <div className="mb-3 space-y-2 rounded-lg border border-roo-100 bg-roo-50 p-3">
              <div className="relative">
                <input className="input pr-20" placeholder="Group name (optional), e.g. Project 2 team" value={groupTitle}
                  maxLength={60} onChange={(e) => setGroupTitle(e.target.value)} aria-label="Group name" />
                <ComposeTools value={groupTitle} onChange={setGroupTitle} className="!bottom-0.5" />
              </div>
              <button className="btn-primary w-full" disabled={picked.length < 1 || !!busy}
                onClick={() => openThread(picked, groupTitle, true)}>
                {busy ? <Spinner /> : <Users className="h-4 w-4" />}Create group with {picked.length} classmate{picked.length === 1 ? '' : 's'}
              </button>
              <p className="text-xs text-roo-800">Pick 1 to 7 classmates from this course below. You can add more people later, and anyone can leave.</p>
            </div>
          )}

          {data.buddies.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-mute">No classmates have made themselves visible yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shownBuddies.length === 0 && <li className="py-4 text-center text-sm text-ink-mute">No classmates match.</li>}
              {shownBuddies.map((b) => (
                <li key={b.id} className="py-3 first:pt-0">
                  <div className="flex items-start gap-3">
                    {picking ? (
                      <input type="checkbox" className="mt-2 h-4 w-4 accent-roo-500" disabled={b.blocked}
                        checked={picked.includes(b.id)} aria-label={`Add ${b.display_name}`}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, b.id].slice(0, 7) : picked.filter((x) => x !== b.id))} />
                    ) : <Avatar id={b.id} name={b.display_name} />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{b.display_name}{b.blocked && <Badge tone="red" className="ml-2">Blocked</Badge>}</p>
                      {b.activity_line ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft">
                          <Sparkles className="h-3 w-3 text-roo-600" />{b.activity_line}
                          {b.activity_at && <span className="text-ink-mute"> · {timeAgo(b.activity_at)}</span>}
                        </p>
                      ) : <p className="mt-0.5 text-xs text-ink-mute">No study activity this week</p>}
                      {b.free.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <CalendarClock className="h-3.5 w-3.5 text-emerald-600" aria-label="Free together" />
                          {b.free.slice(0, 3).map((s) => (
                            <span key={s.start} className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100">{s.label}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {!picking && data.visible && !b.blocked && (
                      <button className="btn-outline h-8 w-8 px-0" disabled={!!busy} title={`Message ${b.display_name}`}
                        aria-label={`Message ${b.display_name}`}
                        onClick={() => (b.thread_id ? setActive(b.thread_id) : openThread([b.id]))}>
                        {busy === b.id ? <Spinner /> : <MessageCircle className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-snug text-ink-mute">
            Green times are when you’re both free in the next 7 days (8am–10pm), from your calendars. Nobody sees what’s on yours.
          </p>
        </div>

        {data.threads.length > 0 && (
          <div className="card p-4">
            <h2 className="card-title mb-2"><MessageCircle className="h-4 w-4 text-ink-mute" />Conversations</h2>
            <ul className="space-y-1">
              {data.threads.map((t) => (
                <li key={t.id}>
                  <button onClick={() => { setActive(t.id); setUnread((u) => { const n = new Set(u); n.delete(t.id); return n; }); }}
                    className={clsx('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left',
                      active === t.id ? 'bg-roo-50' : 'hover:bg-slate-50')}>
                    {t.is_group
                      ? <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-600 text-white"><Users className="h-4 w-4" /></span>
                      : <Avatar id={t.members[0]?.id ?? t.id} name={t.members[0]?.display_name ?? '?'} size={32} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {t.title || t.members.map((m) => m.display_name).join(', ') || 'Conversation'}
                      </span>
                      <span className="block text-xs text-ink-mute">{t.last_at ? timeAgo(t.last_at) : 'No messages yet'}</span>
                    </span>
                    {unread.has(t.id) && <span className="h-2 w-2 rounded-full bg-roo-600" aria-label="New messages" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </aside>

      <section>
        {active ? (
          <ThreadView key={active} threadId={active} me={me} tick={tick} status={status} accent={courseColor}
            classmates={data.buddies} onClose={() => setActive(null)} onChanged={load} />
        ) : (
          <div className="space-y-4">
            <Empty icon={<MessageCircle />} title="Select a classmate to start a conversation">
              Classmates studying the same module show up first, with the times you’re both free. Start a one-to-one chat
              or a small study group, without ever sharing an email address or phone number.
            </Empty>
          </div>
        )}
      </section>
    </div>
    </div>
  );
}

// ------------------------------------------------------------------ thread
function ThreadView({ threadId, me, tick, status, accent, classmates, onClose, onChanged }: {
  threadId: string; me: Me; tick: number; status: string; accent: string; classmates: Buddy[];
  onClose: () => void; onChanged: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reporting, setReporting] = useState<{ messageId?: string; userId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const loadAll = useCallback(async () => {
    try {
      const r = await api<{ thread: Thread; messages: Msg[] }>(`/api/threads/${threadId}`);
      setThread(r.thread);
      setMsgs(r.messages);
      lastRef.current = r.messages.at(-1)?.created_at ?? null;
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [threadId]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // A push from the chat server only says "something new"; fetch it through the API.
  useEffect(() => {
    if (tick === 0) return;
    const q = lastRef.current ? `?after=${encodeURIComponent(lastRef.current)}` : '';
    api<{ messages: Msg[] }>(`/api/threads/${threadId}/messages${q}`).then((r) => {
      if (!r.messages.length) return;
      setMsgs((m) => {
        const seen = new Set(m.map((x) => x.id));
        return [...m, ...r.messages.filter((x) => !seen.has(x.id))];
      });
      lastRef.current = r.messages.at(-1)!.created_at;
    }).catch(() => {});
  }, [tick, threadId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    const ext = `.${(f.name.split('.').pop() ?? '').toLowerCase()}`;
    if (!ACCEPT.split(',').includes(ext)) { setErr('You can share images, PDFs, Word, Excel, PowerPoint, text, CSV and ZIP files.'); return; }
    if (f.size > MAX_FILE) { setErr('Files up to 10 MB can be shared in chat.'); return; }
    setErr(null);
    setFile(f);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body && !file) return;
    setSending(true);
    setErr(null);
    try {
      let r: { message: Msg };
      if (file) {
        const fd = new FormData();
        fd.set('file', file);
        fd.set('body', body);
        const res = await fetch(`/api/threads/${threadId}/attachments`, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `Upload failed (${res.status})`);
        r = data as { message: Msg };
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
      } else {
        r = await api<{ message: Msg }>(`/api/threads/${threadId}/messages`, { body: { body } });
      }
      setText('');
      setMsgs((m) => (m.some((x) => x.id === r.message.id) ? m : [...m, r.message]));
      lastRef.current = r.message.created_at;
      onChanged();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function addPeople() {
    if (!toAdd.length) return;
    setGroupBusy(true);
    setErr(null);
    try {
      const r = await api<{ added: number }>(`/api/threads/${threadId}/members`, { body: { memberIds: toAdd } });
      setNotice(`${r.added} classmate${r.added === 1 ? '' : 's'} added to the group.`);
      setAdding(false);
      setToAdd([]);
      await loadAll();
      onChanged();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setGroupBusy(false);
    }
  }

  async function deleteForMe(messageId: string) {
    if (!(await confirm({
      title: 'Delete this message for you?', confirmLabel: 'Delete for me', danger: true,
      body: 'It disappears from your screen only. Everyone else in the chat still sees it.',
    }))) return;
    try {
      await api(`/api/threads/${threadId}/messages/${messageId}`, { method: 'DELETE' });
      setMsgs((list) => list.filter((x) => x.id !== messageId));
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  async function leaveGroup() {
    if (!(await confirm({
      title: 'Leave this group?', confirmLabel: 'Leave group', danger: true,
      body: 'You’ll stop getting its messages, and the others will see that you left. Someone in the group can add you back.',
    }))) return;
    setGroupBusy(true);
    try {
      await api(`/api/threads/${threadId}/leave`, { body: {} });
      onChanged();
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setGroupBusy(false);
    }
  }

  async function toggleBlock(m: Member) {
    if (!m.blocked && !(await confirm({
      title: `Block ${m.display_name}?`, confirmLabel: 'Block', danger: true,
      body: 'They won’t be able to message you, and you’ll disappear from each other’s free time. You can unblock later.',
    }))) return;
    try {
      await api(`/api/threads/${threadId}/block`, { body: { userId: m.id, unblock: m.blocked } });
      setNotice(m.blocked ? `${m.display_name} is unblocked.` : `${m.display_name} is blocked.`);
      await loadAll();
      onChanged();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  if (!thread) return err ? <p className="text-red-600" role="alert">{err}</p> : <div className="card flex h-[560px] items-center justify-center"><Spinner /></div>;
  const name = thread.title || thread.members.map((m) => m.display_name).join(', ');

  return (
    <div className={clsx('card relative flex h-[calc(100vh-15rem)] min-h-[480px] flex-col overflow-hidden', dragging && 'ring-2 ring-roo-500')}
      onDragOver={(e) => { if (!thread.blocked && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!thread.blocked) pick(e.dataTransfer.files?.[0]); }}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-roo-50/90 text-sm font-semibold text-roo-700">
          <Paperclip className="mr-2 h-5 w-5" />Drop the file to share it
        </div>
      )}
      {confirmDialog}
      <header className="flex items-center gap-3 border-b border-line px-4 py-3" style={{ borderTop: `3px solid ${accent}` }}>
        <button className="btn-ghost h-8 w-8 px-0 xl:hidden" onClick={onClose} aria-label="Back to classmates"><ArrowLeft className="h-4 w-4" /></button>
        {thread.is_group
          ? <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-600 text-white"><Users className="h-4 w-4" /></span>
          : <Avatar id={thread.members[0]?.id ?? thread.id} name={thread.members[0]?.display_name ?? '?'} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-mute">
            <span className={clsx('h-2 w-2 rounded-full', status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-gold-400' : 'bg-red-400')} />
            {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            {thread.is_group && ` · ${thread.members.length + 1} people`}
            <span className="ml-1 inline-flex items-center gap-1 text-emerald-700"><ShieldCheck className="h-3 w-3" />encrypted</span>
          </p>
        </div>
        {thread.is_group && (
          <>
            <button className={clsx('btn-ghost h-8 px-2 text-xs', adding ? 'text-roo-700' : 'text-ink-soft')} onClick={() => { setAdding(!adding); setToAdd([]); }}
              title="Add classmates to this group" aria-label="Add people" aria-expanded={adding}>
              <UserPlus className="h-4 w-4" /><span className="hidden sm:inline">Add people</span>
            </button>
            <button className="btn-ghost h-8 px-2 text-xs text-ink-soft hover:text-red-700" onClick={leaveGroup} disabled={groupBusy}
              title="Leave this group" aria-label="Leave group">
              <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Leave</span>
            </button>
          </>
        )}
        <button className="btn-ghost h-8 w-8 px-0 text-ink-mute" title="Report this conversation" aria-label="Report this conversation"
          onClick={() => setReporting({ userId: thread.is_group ? undefined : thread.members[0]?.id })}>
          <Flag className="h-4 w-4" />
        </button>
        {!thread.is_group && thread.members[0] && (
          <button className="btn-ghost h-8 w-8 px-0 text-ink-mute" onClick={() => toggleBlock(thread.members[0])}
            title={thread.members[0].blocked ? 'Unblock' : 'Block'} aria-label={thread.members[0].blocked ? 'Unblock' : 'Block'}>
            <Ban className={clsx('h-4 w-4', thread.members[0].blocked && 'text-red-600')} />
          </button>
        )}
      </header>

      {thread.is_group && (
        <div className="flex flex-wrap gap-1.5 border-b border-line bg-slate-50 px-5 py-2 text-xs">
          {thread.members.map((m) => (
            <span key={m.id} className="chip bg-white text-ink-soft ring-1 ring-inset ring-line">
              {m.display_name}
              <button onClick={() => toggleBlock(m)} className={clsx('ml-1', m.blocked ? 'text-red-600' : 'text-ink-mute hover:text-red-600')}
                aria-label={`${m.blocked ? 'Unblock' : 'Block'} ${m.display_name}`} title={m.blocked ? 'Unblock' : 'Block'}>
                <Ban className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {thread.is_group && adding && (() => {
        const inGroup = new Set(thread.members.map((m) => m.id));
        const candidates = classmates.filter((b) => !inGroup.has(b.id) && !b.blocked);
        const room = Math.max(0, 7 - thread.members.length);
        return (
          <div className="border-b border-line bg-roo-50 px-5 py-3">
            <p className="mb-2 text-xs font-semibold text-roo-800">Add classmates from this course ({room} more can join)</p>
            {candidates.length === 0 ? (
              <p className="text-xs text-ink-soft">Everyone visible in this course is already in the group.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {candidates.map((b) => (
                  <li key={b.id}>
                    <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-ink hover:bg-white/70">
                      <input type="checkbox" className="h-4 w-4 accent-roo-500" checked={toAdd.includes(b.id)}
                        disabled={!toAdd.includes(b.id) && toAdd.length >= room}
                        onChange={(e) => setToAdd(e.target.checked ? [...toAdd, b.id] : toAdd.filter((x) => x !== b.id))} />
                      <Avatar id={b.id} name={b.display_name} size={22} />{b.display_name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <button className="btn-primary btn-sm" disabled={!toAdd.length || groupBusy} onClick={addPeople}>
                {groupBusy ? <Spinner /> : <UserPlus className="h-4 w-4" />}Add {toAdd.length || ''}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => { setAdding(false); setToAdd([]); }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-5 py-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="mx-auto mt-10 max-w-sm text-center text-sm text-ink-mute">
            <BookOpen className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            Say hi, and maybe suggest one of the free times you share. Messages can be translated with one tap.
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={clsx('group flex gap-2', m.mine && 'flex-row-reverse')}>
            {!m.mine && <Avatar id={m.sender_id} name={m.sender_name} size={28} />}
            <div className={clsx('max-w-[75%] rounded-lg px-3.5 py-2 text-sm',
              m.mine ? 'rounded-br-sm bg-roo-600 text-white' : 'rounded-bl-sm border border-line bg-white text-ink')}>
              {!m.mine && thread.is_group && <p className="mb-0.5 text-xs font-semibold" style={{ color: colorFor(m.sender_id) }}>{m.sender_name}</p>}
              {m.attachments?.map((a) => <AttachmentView key={a.id} a={a} mine={m.mine} />)}
              {m.body && (m.mine
                ? <p className="whitespace-pre-wrap" dir="auto">{m.body}</p>
                : <Translatable text={m.body} kind="message" lang={me.lang} />)}
              <p className={clsx('mt-1 text-[10px]', m.mine ? 'text-roo-100' : 'text-ink-mute')}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
            <div className="flex flex-col justify-center gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <button className="text-ink-mute hover:text-red-600"
                onClick={() => deleteForMe(m.id)} aria-label="Delete this message for me" title="Delete for me">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {!m.mine && (
                <button className="text-ink-mute hover:text-red-600"
                  onClick={() => setReporting({ messageId: m.id })} aria-label="Report this message" title="Report this message">
                  <Flag className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {notice && <p className="border-t border-line bg-emerald-50 px-5 py-2 text-xs text-emerald-700" role="status">{notice}</p>}
      {reporting && <ReportBox threadId={threadId} target={reporting} onDone={(ok) => { setReporting(null); if (ok) setNotice('Thanks. Your report was logged for review with the message and both accounts.'); }} />}

      {thread.blocked ? (
        <p className="border-t border-line bg-red-50 px-5 py-4 text-sm text-red-700">
          Messaging is off because one of you blocked the other.
        </p>
      ) : (
        <form onSubmit={send} className="border-t border-line bg-white px-4 py-3">
          {file && (
            <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-line bg-slate-50 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-ink-mute" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
              <span className="shrink-0 text-xs text-ink-mute">{fmtSize(file.size)}</span>
              <button type="button" className="btn-ghost h-7 w-7 shrink-0 px-0" aria-label="Remove file"
                onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" className="btn-outline h-[42px] w-[42px] shrink-0 px-0" onClick={() => fileRef.current?.click()}
              disabled={sending} aria-label="Attach a file" title="Attach a file (images, PDF, Office, text, ZIP · up to 10 MB)">
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea className="input max-h-32 min-h-[42px] resize-none" rows={1} value={text} maxLength={2000}
              placeholder={file ? 'Add a caption (optional)…' : 'Write a message…'} aria-label="Message" dir="auto"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }} />
            <ComposeTools value={text} onChange={setText} placement="beside" />
            <button className="btn-primary h-[42px] w-[42px] shrink-0 px-0" disabled={sending || (!text.trim() && !file)} aria-label="Send">
              {sending ? <Spinner /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </form>
      )}
      {err && <p className="px-5 pb-3 text-xs text-red-600" role="alert">{err}</p>}
    </div>
  );
}

function ReportBox({ threadId, target, onDone }: {
  threadId: string; target: { messageId?: string; userId?: string }; onDone: (ok: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/threads/${threadId}/report`, { body: { ...target, reason } });
      onDone(true);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line bg-red-50/60 px-5 py-3">
      <p className="text-sm font-semibold text-red-800">{target.messageId ? 'Report this message' : 'Report this conversation'}</p>
      <div className="flex flex-wrap gap-1.5">
        {['Harassment', 'Spam', 'Asking for answers to graded work', 'Makes me uncomfortable'].map((r) => (
          <button type="button" key={r} onClick={() => setReason(r)}
            className={clsx('chip border', reason === r ? 'border-red-400 bg-red-100 text-red-800' : 'border-line bg-white text-ink-soft')} aria-pressed={reason === r}>{r}</button>
        ))}
      </div>
      <div className="relative">
        <input className="input pr-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or describe what happened" maxLength={500} aria-label="Reason" />
        <ComposeTools value={reason} onChange={setReason} className="!bottom-0.5" />
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-danger btn-sm" disabled={busy || reason.trim().length < 3}>{busy && <Spinner />}Send report</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}
