import type { Db } from '@/lib/db';

// Notifications are written by database triggers (db/init/070_notifications.sql); the app only
// reads its own (row level security) and marks them read.
export type Notification = {
  id: string; kind: string; title: string; body: string | null; link: string;
  created_at: string; read_at: string | null; outgoing: boolean;
};

export async function listNotifications(db: Db, limit = 50): Promise<{ unread: number; items: Notification[] }> {
  const items = (await db.query(
    `SELECT id, kind, title, body, link, created_at, read_at, outgoing FROM notifications
      ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT $1`, [limit])).rows as Notification[];
  const unread = (await db.query('SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL')).rows[0].n as number;
  return { unread, items };
}

export async function markRead(db: Db, ids: string[] | 'all') {
  if (ids === 'all') await db.query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL');
  else if (ids.length) await db.query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL AND id = ANY($1::uuid[])', [ids]);
}
