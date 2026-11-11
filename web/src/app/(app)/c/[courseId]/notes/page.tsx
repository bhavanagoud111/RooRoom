import { redirect } from 'next/navigation';
import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { LABEL_TEXT, RULES, myNotes, noteGate } from '@/lib/features/notes';
import { PageHeader } from '@/components/ui';
import { NoteCompose, NoteThread } from './NotesClient';
import { TAGS } from '../tags';

export default async function NotesPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  if (c.is_prof) redirect(`/c/${c.id}/inbox`);
  const [gate, notes] = await Promise.all([noteGate(me, c), myNotes(me, c.id)]);
  const iso = (d: string | null) => (d ? new Date(d).toISOString() : null);

  return (
    <div>
    <PageHeader title="Anonymous Feedback"
      description={TAGS.notes} />
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <NoteCompose courseId={c.id} professor={c.professor_name ?? 'your professor'} gate={gate} rules={RULES} />
      <NoteThread
        labelText={LABEL_TEXT}
        notes={notes.map((n) => ({
          ...n, created_at: iso(n.created_at)!, delivered_at: iso(n.delivered_at), deliver_after: iso(n.deliver_after),
          replies: n.replies.map((r) => ({ ...r, created_at: iso(r.created_at)! })),
        }))}
      />
    </div>
    </div>
  );
}
