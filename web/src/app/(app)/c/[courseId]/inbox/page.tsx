import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { inbox } from '@/lib/features/notes';
import { PageHeader } from '@/components/ui';
import { InboxClient } from './InboxClient';
import { TAGS } from '../tags';
import { SummarizeButton } from '../dashboard/Summarize';

export default async function InboxPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  if (!c.is_prof) notFound();
  const notes = await inbox(me, c.id);
  const muted = c.notes_muted_until && new Date(c.notes_muted_until) > new Date() ? new Date(c.notes_muted_until).toISOString() : null;
  return (
    <div>
    <PageHeader title="Anonymous Feedback" description={TAGS.inbox} />
    <div className="card mb-6 p-5"><SummarizeButton courseId={c.id} kind="feedback" count={notes.length} /></div>
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <InboxClient
        courseId={c.id}
        notes={notes.map((n) => ({
          ...n, delivered_at: new Date(n.delivered_at).toISOString(),
          replies: n.replies.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
        }))}
        notesEnabled={c.notes_enabled}
        mutedUntil={muted}
        demo={process.env.DEV_SHOW_CODES === 'true'}
      />
      <aside className="space-y-3">
        <p className="card p-4 text-xs text-ink-mute">Screened, anonymous, delivered daily at 8:00. You can reply; you can’t unmask.</p>
      </aside>
    </div>
    </div>
  );
}
