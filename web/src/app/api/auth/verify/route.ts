import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError, sha256 } from '@/lib/auth';
import { anonymous } from '@/lib/db';

const Schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/, 'the code is 6 digits'),
});

export const POST = route(async (req) => {
  const { email, code } = await body(req, Schema);
  const r = await anonymous((db) => db.query('SELECT auth_verify_email($1, $2) AS ok', [email, sha256(code)]));
  if (!r.rows[0]?.ok) throw new HttpError(400, 'That code is wrong or has expired.');
  return { ok: true };
}, { public: true });
