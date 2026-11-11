'use client';
// The application shell: global sidebar (a drawer on small screens), top header with breadcrumbs
// and the profile menu. Server data (the user and their courses) is passed in from layout.tsx.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Bell, BookOpen, CalendarDays, ChevronDown, LayoutDashboard, LogOut, Menu, MessagesSquare, Settings, X,
} from 'lucide-react';
import { NotificationBell } from '@/components/Notifications';
import { api } from '@/components/client';
import { Breadcrumbs, CourseSwatch, Logo, type Crumb } from '@/components/ui';

type ShellCourse = { id: string; code: string; title: string; color: string; is_prof: boolean };
type ShellUser = { name: string; role: 'student' | 'professor'; language: string };

const COURSE_SECTIONS: Record<string, string> = {
  study: 'Study AI', ask: 'Ask Professor', notes: 'Anonymous Feedback', buddies: 'Study Buddies',
  materials: 'Materials & Syllabus', dashboard: 'Clarifications', inbox: 'Anonymous Feedback', settings: 'Course Settings',
};
const TOP: Record<string, string> = {
  dashboard: 'Dashboard', courses: 'Courses', calendar: 'Calendar', messages: 'Messages', notifications: 'Notifications', settings: 'Settings',
};

function crumbsFor(path: string, courses: ShellCourse[]): Crumb[] {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[1]) {
    const c = courses.find((x) => x.id === parts[1]);
    const out: Crumb[] = [{ label: 'Courses', href: '/courses' }, { label: c?.code ?? 'Course', href: `/c/${parts[1]}` }];
    out.push({ label: parts[2] ? COURSE_SECTIONS[parts[2]] ?? parts[2] : 'Home' });
    return out;
  }
  return [{ label: TOP[parts[0]] ?? 'RooRoom' }];
}

export function AppShell({ user, courses, children }: { user: ShellUser; courses: ShellCourse[]; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/courses', label: 'Courses', icon: BookOpen, also: '/c/' },
    ...(user.role === 'student' ? [
      { href: '/calendar', label: 'Calendar', icon: CalendarDays },
      { href: '/messages', label: 'Messages', icon: MessagesSquare },
    ] : []),
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
  const activeCourse = path.startsWith('/c/') ? path.split('/')[2] : null;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-line px-4">
        <Link href="/dashboard" aria-label="RooRoom dashboard"><Logo size={30} /></Link>
        <button className="btn-ghost h-8 w-8 px-0 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {nav.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`) || (!!l.also && path.startsWith(l.also));
            const Icon = l.icon;
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={active ? 'page' : undefined}
                  className={clsx('flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                    active ? 'bg-roo-50 text-roo-700' : 'text-ink-soft hover:bg-slate-100 hover:text-ink')}>
                  <Icon className={clsx('h-4 w-4', active ? 'text-roo-600' : 'text-ink-mute')} aria-hidden />{l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {courses.length > 0 && (
          <div className="mt-6">
            <p className="eyebrow px-3">{user.role === 'professor' ? 'Teaching' : 'My courses'}</p>
            <ul className="mt-2 space-y-0.5">
              {courses.map((c) => (
                <li key={c.id}>
                  <Link href={`/c/${c.id}`} title={c.title} aria-current={activeCourse === c.id ? 'true' : undefined}
                    className={clsx('flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      activeCourse === c.id ? 'bg-slate-100 font-medium text-ink' : 'text-ink-soft hover:bg-slate-100 hover:text-ink')}>
                    <CourseSwatch color={c.color} />
                    <span className="min-w-0">
                      <span className="block truncate">{c.code}</span>
                      <span className="block truncate text-xs text-ink-mute">{c.title}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
      <p className="border-t border-line px-4 py-3 text-xs text-ink-mute">University of Missouri–Kansas City</p>
    </div>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-white lg:block">{sidebar}</aside>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-lift">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
          <button className="btn-ghost h-9 w-9 px-0 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
            <Menu className="h-5 w-5" />
          </button>
          <Breadcrumbs items={crumbsFor(path, courses)} className="min-w-0 flex-1" />
          <NotificationBell />
          <UserMenu user={user} />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const initial = user.name.replace(/^Dr\.\s*/, '').slice(0, 1).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-white" aria-hidden>{initial}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-ink">{user.name}</span>
          <span className="block text-xs leading-tight text-ink-mute">{user.role === 'professor' ? 'Professor' : 'Student'} · {user.language}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-ink-mute" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lift">
          <div className="border-b border-line px-3 py-2 sm:hidden">
            <p className="text-sm font-medium text-ink">{user.name}</p>
            <p className="text-xs text-ink-mute">{user.role === 'professor' ? 'Professor' : 'Student'}</p>
          </div>
          <Link role="menuitem" href="/settings" className="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-slate-50"><Settings className="h-4 w-4" />Profile & settings</Link>
          <button role="menuitem" className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-ink-soft hover:bg-slate-50"
            onClick={async () => { await api('/api/auth/logout', { body: {} }); router.push('/login'); router.refresh(); }}>
            <LogOut className="h-4 w-4" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}
