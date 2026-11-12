import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError, createSession, sha256 } from '@/lib/auth';
import { anonymous, withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

const Schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  challenge: z.string().min(20).max(100),
  code: z.string().trim().regex(/^\d{6}$/, 'the code is 6 digits'),
});

/** Step 2 of sign-in: the 6-digit code from the email. 5 wrong tries and the code stops working. */
export const POST = route(async (req) => {
  const { email, challenge, code } = await body(req, Schema);
  const r = await anonymous((db) => db.query('SELECT auth_login_code($1, $2, $3) AS uid', [email, sha256(challenge), sha256(code)]));
  const uid = r.rows[0]?.uid as string | null;
  if (!uid) throw new HttpError(400, 'That code is wrong or has expired. Check the newest email, or send a new code.');
  await createSession(uid);
  await withUser(uid, (db) => audit(db, uid, 'login', { code: true }));
  return { ok: true };
}, { public: true });
