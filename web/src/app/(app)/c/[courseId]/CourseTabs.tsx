'use client';
// CourseTabs: a centred tab row under the course header on every course page except Course Home,
// where the same sections appear as tiles. Scrolls sideways on narrow screens.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { courseNav } from './nav';

export function CourseTabs({ courseId, isProf }: { courseId: string; isProf: boolean }) {
  const path = usePathname();
  const items = courseNav(courseId, isProf);
  if (path === `/c/${courseId}`) return null;
  const isActive = (t: (typeof items)[number]) => (t.exact ? path === t.href : path.startsWith(t.href));
  return (
    <nav className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0" aria-label="Course">
      <ul className="flex w-max min-w-full gap-1 lg:justify-center">
        {items.map((t) => {
          const active = isActive(t);
          return (
            <li key={t.href} className="shrink-0">
              <Link href={t.href} aria-current={active ? 'page' : undefined}
                className={clsx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap',
                  active ? 'border-roo-600 text-roo-700' : 'border-transparent text-ink-mute hover:text-ink')}>
                <t.icon className="h-4 w-4" aria-hidden />{t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
