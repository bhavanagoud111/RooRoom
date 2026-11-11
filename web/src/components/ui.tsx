// RooRoom's shared, server-safe UI components. Interactive pieces live in client.tsx and shell.tsx.
import clsx from 'clsx';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function Logo({ size = 32, inverted = false }: { size?: number; inverted?: boolean }) {
  // The word scales with the mark, so a bigger logo is bigger everywhere it is used.
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#2563EB" />
        <path d="M18 46V18h16a10 10 0 0 1 2 19.8L46 46h-9l-9-8h-2v8z" fill="#fff" />
        <rect x="26" y="25" width="8" height="6" rx="3" fill="#2563EB" />
      </svg>
      <span className={clsx('font-bold tracking-tight', inverted ? 'text-white' : 'text-ink')} style={{ fontSize: Math.round(size * 0.72) }}>RooRoom</span>
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card', className)}>{children}</div>;
}

/** A titled card: header row with an icon, title and optional action, then content. */
export function SectionCard({ title, icon, action, children, className, bodyClassName, id }: {
  title: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode;
  className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section className={clsx('card overflow-hidden', className)} aria-labelledby={id}>
      <div className="card-header">
        <h2 id={id} className="card-title">{icon && <span className="text-ink-mute">{icon}</span>}{title}</h2>
        {action}
      </div>
      <div className={bodyClassName ?? 'p-5'}>{children}</div>
    </section>
  );
}

/** Page title block used at the top of every screen. */
export function PageHeader({ title, description, actions, eyebrow }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Kept for existing callers: a smaller in-page section heading. */
export function SectionTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-ink-mute">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-ink-mute">
        {items.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
            {c.href && i < items.length - 1
              ? <Link href={c.href} className="truncate hover:text-ink hover:underline">{c.label}</Link>
              : <span className="truncate font-medium text-ink" aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const tones = {
  blue: 'bg-roo-50 text-roo-700 ring-roo-100',
  gold: 'bg-gold-50 text-gold-700 ring-gold-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  purple: 'bg-slate-100 text-slate-700 ring-slate-200',
} as const;
export type Tone = keyof typeof tones;

/** StatusBadge. Small, square-cornered label; colour carries meaning only alongside text. */
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('chip ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}
export const StatusBadge = Badge;

/** EmptyState */
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-ink-mute [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-mute">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export const EmptyState = Empty;

/** LoadingSkeleton: grey bars that hold the layout while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />;
}
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-full" /></div>
      ))}
    </div>
  );
}

/** Compact summary number for dashboards. Only ever fed real counts. */
export function Metric({ label, value, icon, href, tone = 'gray' }: {
  label: string; value: number | string; icon?: ReactNode; href?: string; tone?: Tone;
}) {
  const accent = { blue: 'text-roo-600', gold: 'text-gold-500', green: 'text-emerald-600', red: 'text-red-600', gray: 'text-ink-mute', purple: 'text-ink-mute' }[tone];
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">{label}</p>
        {icon && <span className={clsx('[&>svg]:h-4 [&>svg]:w-4', accent)}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </>
  );
  return href
    ? <Link href={href} className="card block p-4 transition-colors hover:border-slate-300">{body}</Link>
    : <div className="card p-4">{body}</div>;
}

/** Small coloured square identifying a course everywhere it appears. */
export function CourseSwatch({ color, className }: { color: string; className?: string }) {
  return <span className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', className)} style={{ background: color }} aria-hidden />;
}

/** CourseCard for dashboards and the course list. */
export function CourseCard({ c, children }: {
  c: { id: string; code: string; title: string; term: string; color: string; professor_name: string | null };
  children?: ReactNode;
}) {
  return (
    <Link href={`/c/${c.id}`} className="card group flex flex-col overflow-hidden transition-colors hover:border-slate-300">
      <div className="h-1.5" style={{ background: c.color }} aria-hidden />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-ink-soft">{c.code}</span>
          <span className="text-xs text-ink-mute">{c.term}</span>
        </div>
        <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-ink group-hover:text-roo-700">{c.title}</h3>
        <p className="mt-1 truncate text-sm text-ink-mute">{c.professor_name ?? 'Instructor not announced'}</p>
        {children && <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">{children}</div>}
      </div>
    </Link>
  );
}

/** Date tile used in deadline lists. */
export function DateTile({ iso, tz, urgent }: { iso: string | Date; tz: string; urgent?: boolean }) {
  const d = new Date(iso);
  return (
    <span className={clsx('flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 leading-none',
      urgent ? 'border-gold-300 bg-gold-50 text-gold-700' : 'border-line bg-white text-ink-soft')}>
      <span className="text-[10px] font-semibold uppercase">{d.toLocaleDateString('en-US', { month: 'short', timeZone: tz })}</span>
      <span className="mt-0.5 text-base font-semibold">{d.toLocaleDateString('en-US', { day: 'numeric', timeZone: tz })}</span>
    </span>
  );
}

export function timeAgo(d: string | Date) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** "Due today", "in 3 days" etc. for deadline lists. */
export function dueLabel(d: string | Date) {
  const h = (new Date(d).getTime() - Date.now()) / 3_600_000;
  if (h < 0) return 'started';
  if (h < 24) return 'within 24 hours';
  const days = Math.round(h / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
