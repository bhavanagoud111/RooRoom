import { assertUuid, route } from '@/lib/api';
import { retryHeld } from '@/lib/features/notes';

type P = { noteId: string };

export const POST = route<P>(async (_req, { me, params }) => retryHeld(me, assertUuid(params.noteId)));
