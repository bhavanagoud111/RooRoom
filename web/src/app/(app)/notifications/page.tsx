import { requireMe } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { listNotifications } from '@/lib/features/notifications';
import { PageHeader } from '@/components/ui';
import { NotificationList } from '@/components/Notifications';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const me = await requireMe();
  const feed = await withUser(me.id, (db) => listNotifications(db, 100), { readOnly: true });
  const items = feed.items.map((n) => ({
    ...n, created_at: new Date(n.created_at).toISOString(), read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
  }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications"
        description={me.role === 'professor'
          ? 'Anonymous questions, feedback and question groups from your students.'
          : 'Answers, announcements, new materials, replies to your notes and messages.'} />
      <NotificationList initial={{ unread: feed.unread, items }} />
    </div>
  );
}
