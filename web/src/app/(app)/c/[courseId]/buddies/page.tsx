import { requireMe } from '@/lib/auth';
import { courseForPage } from '@/lib/courses';
import { Empty } from '@/components/ui';
import { Buddies } from './Buddies';

export default async function BuddiesPage({ params, searchParams }: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { courseId } = await params;
  const { thread } = await searchParams;
  const me = await requireMe();
  const c = await courseForPage(me, courseId);
  if (c.is_prof) {
    return (
      <Empty title="Study buddies are for students">
        Professors are not in the buddy list and can’t be messaged through chat. Students reach you through the question
        pool and anonymous notes, which are screened before anything is delivered.
      </Empty>
    );
  }
  return (
    <Buddies courseId={c.id} courseColor={c.color} me={{ id: me.id, name: me.display_name, lang: me.preferred_language }}
      initialThread={thread && /^[0-9a-f-]{36}$/i.test(thread) ? thread : null} />
  );
}
