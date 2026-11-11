import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { StudyClient } from './StudyClient';

export default async function StudyPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  return <StudyClient courseId={c.id} courseCode={c.code} lang={me.preferred_language} />;
}
