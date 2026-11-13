import { assertUuid, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { hideMessage } from '@/lib/features/chat';

type P = { threadId: string; messageId: string };

/** "Delete for me": removes the message from this person's view only. */
export const DELETE = route<P>(async (_req, { me, params }) => {
  const threadId = assertUuid(params.threadId);
  const messageId = assertUuid(params.messageId);
  return withUser(me.id, async (db) => {
    await hideMessage(db, threadId, messageId);
    return { ok: true };
  });
});
