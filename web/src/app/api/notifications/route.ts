import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { listNotifications } from '@/lib/features/notifications';

export const GET = route(async (_req, { me }) =>
  withUser(me.id, (db) => listNotifications(db), { readOnly: true }));
