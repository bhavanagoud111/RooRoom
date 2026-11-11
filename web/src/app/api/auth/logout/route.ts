import { route } from '@/lib/api';
import { destroySession } from '@/lib/auth';

export const POST = route(async () => {
  await destroySession();
  return { ok: true };
}, { public: true });
