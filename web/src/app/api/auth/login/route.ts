import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError, createSession, verifyPassword } from '@/lib/auth';
import { anonymous, withUser } from '@/lib/db';
import { audit } from '@/lib/limits';

const Schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

// A bcrypt hash of a random string, compared when the email does not exist so that response
// time does not reveal which addresses have accounts.
const DUMMY = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

const attempts = new Map<string, { n: number; until: number }>();

export const POST = route(async (req) => {
  const { email, password } = await body(req, Schema);
  const a = attempts.get(email);
  if (a && a.n >= 5 && a.until > Date.now()) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');

  const r = await anonymous((db) => db.query('SELECT * FROM auth_find_user($1)', [email]));
  const user = r.rows[0] as { id: string; password_hash: string; verified: boolean } | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY);
  if (!user || !ok) {
    const cur = attempts.get(email);
    attempts.set(email, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: Date.now() + 60_000 });
    throw new HttpError(401, 'Email or password is wrong.');
  }
  if (!user.verified) throw new HttpError(403, 'Verify your email address first.');
  attempts.delete(email);
  await createSession(user.id);
  await withUser(user.id, (db) => audit(db, user.id, 'login'));
  return { ok: true };
}, { public: true });
