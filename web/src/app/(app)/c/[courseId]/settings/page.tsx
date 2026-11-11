import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { PageHeader } from '@/components/ui';
import { SettingsForm } from './SettingsForm';
import { TAGS } from '../tags';

export default async function CourseSettings({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  if (!c.is_prof) notFound();
  return (
    <div>
    <PageHeader title="Course Settings" description={TAGS.settings} />
    <SettingsForm courseId={c.id} initial={{
      clusterThreshold: c.cluster_threshold,
      similarityCutoff: Number(c.similarity_cutoff),
      notesEnabled: c.notes_enabled,
      notesWeeklyLimit: c.notes_weekly_limit,
      mutedUntil: c.notes_muted_until && new Date(c.notes_muted_until) > new Date() ? new Date(c.notes_muted_until).toISOString() : null,
    }} />
    </div>
  );
}
