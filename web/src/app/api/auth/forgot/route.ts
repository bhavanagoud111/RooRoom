import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { anonymous } from '@/lib/db';
import { issueCode, mailEnabled, skipsCode } from '@/lib/mail';

const Schema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });

/**
 * Forgot password, step 1: email a reset code. The answer is the same whether or not the
 * account exists, so this page can't be used to find out who has an account.
 * Accounts on OTP_SKIP_EMAILS are never emailed (the demo addresses aren't real inboxes).
 */
export const POST = route(async (req) => {
  const { email } = await body(req, Schema);
  if (!mailEnabled()) throw new HttpError(503, 'Password reset by email isn’t switched on yet.');
  if (skipsCode(email)) return { ok: true };
  const r = await anonymous((db) => db.query('SELECT id FROM auth_find_user($1)', [email]));
  const id = r.rows[0]?.id as string | undefined;
  if (id) {
    try {
      await issueCode(id, email, 'reset');
    } catch (e) {
      // Too many codes this hour: say nothing different, to keep the answer the same for everyone.
      if (!(e instanceof HttpError && e.status === 429)) throw e;
    }
  }
  return { ok: true };
}, { public: true });
