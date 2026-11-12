import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError, hashPassword, sha256 } from '@/lib/auth';
import { anonymous } from '@/lib/db';

const Schema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  code: z.string().trim().regex(/^\d{6}$/, 'the code is 6 digits'),
  password: z.string().min(10, 'use at least 10 characters').max(200),
});

/** Forgot password, step 2: the emailed code plus the new password. Signs out every device. */
export const POST = route(async (req) => {
  const { email, code, password } = await body(req, Schema);
  const hash = await hashPassword(password);
  const r = await anonymous((db) => db.query('SELECT auth_reset_with_code($1, $2, $3) AS ok', [email, sha256(code), hash]));
  if (!r.rows[0]?.ok) throw new HttpError(400, 'That code is wrong or has expired. Send a new code and try again.');
  return { ok: true };
}, { public: true });
