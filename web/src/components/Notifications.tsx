'use client';
// Notification bell (top bar), the pop-up for new notifications, and the Notifications page list.
// The bell checks for new notifications every 20 seconds while the tab is open.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Bell, BellRing, CheckCheck, Megaphone, MessageCircle, FileText, MessageSquareReply, Users, X } from 'lucide-react';
import { api } from '@/components/client';

export type Notif = {
  id: string; kind: string; title: string; body: string | null; link: string; created_at: string; read_at: string | null;
};
type Feed = { unread: number; items: Notif[] };

const ICONS: Record<string, typeof Bell> = {
  note: MessageCircle, note_reply: MessageSquareReply, digest: Users, answer: MessageSquareReply,
  announcement: Megaphone, material: FileText, message: MessageCircle,
};

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function markRead(ids: string[] | 'all') {
  await api('/api/notifications/read', { body: ids === 'all' ? { all: true } : { ids } }).catch(() => {});
  window.dispatchEvent(new Event('rooroom:notifications'));
}

/** Bell with the unread count, plus a pop-up in the corner when a new notification arrives. */
export function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [popup, setPopup] = useState<Notif | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const f = await api<Feed>('/api/notifications');
      setUnread(f.unread);
      const fresh = f.items.filter((n) => !n.read_at);
      if (seen.current) {
        const newest = fresh.find((n) => !seen.current!.has(n.id));
        if (newest) setPopup(newest);
      }
      seen.current = new Set(f.items.map((n) => n.id));
    } catch { /* signed out or offline: try again next time */ }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 20000);
    const onChange = () => poll();
    window.addEventListener('rooroom:notifications', onChange);
    document.addEventListener('visibilitychange', onChange);
    return () => { clearInterval(t); window.removeEventListener('rooroom:notifications', onChange); document.removeEventListener('visibilitychange', onChange); };
  }, [poll]);

  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(() => setPopup(null), 8000);
    return () => clearTimeout(t);
  }, [popup]);

  return (
    <>
      <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-slate-100 hover:text-ink">
        {unread ? <BellRing className="h-5 w-5" aria-hidden /> : <Bell className="h-5 w-5" aria-hidden />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      {popup && (
        <div role="status" aria-live="polite"
          className="fixed bottom-4 right-4 z-50 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line border-l-4 border-l-red-600 bg-white shadow-lift">
          <div className="flex items-start gap-3 p-4">
            <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
            <button className="min-w-0 flex-1 text-left" onClick={async () => { const n = popup; setPopup(null); await markRead([n.id]); router.push(n.link); }}>
              <p className="text-sm font-semibold text-ink">{popup.title}</p>
              {popup.body && <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{popup.body}</p>}
              <p className="mt-1 text-xs font-medium text-roo-600">Open</p>
            </button>
            <button className="btn-ghost h-7 w-7 shrink-0 px-0" onClick={() => setPopup(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </>
  );
}

/** The Notifications page: unread first with a red bar; clicking one marks it read and opens it. */
export function NotificationList({ initial }: { initial: Feed }) {
  const router = useRouter();
  const [feed, setFeed] = useState(initial);

  const refresh = useCallback(async () => {
    try { setFeed(await api<Feed>('/api/notifications')); } catch { /* keep what we have */ }
  }, []);
  useEffect(() => {
    window.addEventListener('rooroom:notifications', refresh);
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
    return () => { window.removeEventListener('rooroom:notifications', refresh); clearInterval(t); };
  }, [refresh]);

  const unread = feed.items.filter((n) => !n.read_at);
  const read = feed.items.filter((n) => n.read_at);

  async function open(n: Notif) {
    if (!n.read_at) await markRead([n.id]);
    router.push(n.link);
  }

  const row = (n: Notif) => {
    const Icon = ICONS[n.kind] ?? Bell;
    const isNew = !n.read_at;
    return (
      <li key={n.id}>
        <button onClick={() => open(n)}
          className={clsx('flex w-full items-start gap-3 border-l-4 px-5 py-4 text-left transition-colors',
            isNew ? 'border-l-red-600 bg-red-50/60 hover:bg-red-50' : 'border-l-transparent hover:bg-slate-50')}>
          <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', isNew ? 'text-red-600' : 'text-ink-mute')} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className={clsx('block text-sm', isNew ? 'font-semibold text-ink' : 'text-ink-soft')}>{n.title}</span>
            {n.body && <span className="mt-0.5 block line-clamp-2 text-sm text-ink-mute">{n.body}</span>}
            <span className="mt-1 block text-xs text-ink-mute">{ago(n.created_at)}</span>
          </span>
          {isNew && <span className="mt-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">Unread</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-mute">{unread.length ? `${unread.length} unread` : 'You’re all caught up.'}</p>
        {unread.length > 0 && (
          <button className="btn-outline" onClick={() => markRead('all')}><CheckCheck className="h-4 w-4" />Mark all as read</button>
        )}
      </div>
      {feed.items.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-mute">No notifications yet. Answers, announcements, notes and messages will show up here.</div>
      ) : (
        <>
          {unread.length > 0 && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">Unread</h2>
              <ul className="divide-y divide-line">{unread.map(row)}</ul>
            </section>
          )}
          {read.length > 0 && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-line px-5 py-3 text-sm font-semibold text-ink-mute">Earlier</h2>
              <ul className="divide-y divide-line">{read.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
