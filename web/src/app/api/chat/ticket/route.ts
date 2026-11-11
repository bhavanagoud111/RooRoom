import { route } from '@/lib/api';
import { chatTicket } from '@/lib/crypto';

// A 60-second signed ticket the chat server verifies. The session cookie never reaches it.
export const GET = route(async (_req, { me }) => ({ ticket: chatTicket(me.id, 60) }));
