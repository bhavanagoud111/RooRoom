import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { Materials } from './Materials';

export default async function MaterialsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  return <Materials courseId={c.id} isProf={c.is_prof} />;
}
