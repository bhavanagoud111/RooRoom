import { requireMe } from '@/lib/auth';
import { myCourses } from '@/lib/courses';
import { languageName } from '@/lib/languages';
import { AppShell } from './AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe();
  const courses = await myCourses(me);
  return (
    <AppShell
      user={{ name: me.display_name, role: me.role, language: languageName(me.preferred_language) }}
      courses={courses.map((c) => ({ id: c.id, code: c.code, title: c.title, color: c.color, is_prof: c.is_prof }))}>
      {children}
    </AppShell>
  );
}
