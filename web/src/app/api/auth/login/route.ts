import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError, createSession, verifyPassword } from '@/lib/auth';
import { anonymous, withUser } from '@/lib/db';
import { audit } from '@/lib/limits';
import { issueCode, maskEmail, needsCode } from '@/lib/mail';

const Schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  // The tab the person picked. Checked before a code is emailed, so the wrong tab costs no email.
  role: z.enum(['student', 'professor']).optional(),
});

// A bcrypt hash of a random string, compared when the email does not exist so that response
// time does not reveal which addresses have accounts.
const DUMMY = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

const attempts = new Map<string, { n: number; until: number }>();

/**
 * Step 1 of sign-in: email + password. When the account needs a code (see lib/mail.ts), a
 * 6-digit code is emailed and the answer is { needCode, challenge }; step 2 is /api/auth/login/code.
 * Accounts on OTP_SKIP_EMAILS (demo accounts) are signed in straight away.
 */
export const POST = route(async (req) => {
  const { email, password, role } = await body(req, Schema);
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
  attempts.delete(email);

  const actual = await withUser(user.id, async (db) =>
    (await db.query('SELECT role FROM profiles WHERE id = $1', [user.id])).rows[0]?.role as string | undefined);
  if (role && actual && actual !== role) {
    throw new HttpError(409, `That is a ${actual} account. Choose “${actual === 'student' ? 'Student' : 'Professor'}” above to sign in.`);
  }

  if (needsCode(email)) {
    const { challenge, status } = await issueCode(user.id, email, 'login');
    await withUser(user.id, (db) => audit(db, user.id, 'login_code_sent', { reused: status === 'reused' }));
    return { needCode: true, challenge, sentTo: maskEmail(email), reused: status === 'reused' };
  }

  if (!user.verified) throw new HttpError(403, 'Verify your email address first.');
  await createSession(user.id);
  await withUser(user.id, (db) => audit(db, user.id, 'login'));
  return { ok: true };
}, { public: true });
