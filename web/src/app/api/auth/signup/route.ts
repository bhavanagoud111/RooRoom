import { z } from 'zod';
import { body, route } from '@/lib/api';
import { HttpError, createSession, hashPassword } from '@/lib/auth';
import { anonymous, withUser } from '@/lib/db';
import { audit } from '@/lib/limits';
import { needsCode } from '@/lib/mail';

const Schema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(10, 'use at least 10 characters').max(200),
  displayName: z.string().trim().min(1).max(60),
  role: z.enum(['student', 'professor']).default('student'),
});

// Sign-up still requires a university email address, so an outsider cannot open an account and
// start writing into a course (how the Canvas breach began).
//
// Students and professors both sign up here. Professors must use their name exactly as on the
// class schedule, and each instructor can be claimed only once.
//
// 2026-11-12: when email codes are on (lib/mail.ts), the new account is NOT signed in here. The
// page goes on to the normal sign-in, which emails a code; entering it verifies the address.
// Accounts on OTP_SKIP_EMAILS are verified and signed in straight away, as before.
export const POST = route(async (req) => {
  const { email, password, displayName, role } = await body(req, Schema);
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? 'umkc.edu').toLowerCase();
  if (!email.endsWith(`@${domain}`)) {
    throw new HttpError(400, `Use your university email address (@${domain}).`);
  }
  const hash = await hashPassword(password);
  const codeNeeded = needsCode(email);
  let created: { user_id: string; rooms: number };
  try {
    created = await anonymous(async (db) =>
      (await db.query('SELECT * FROM auth_signup_v2($1, $2, $3, $4::user_role, $5)', [email, hash, displayName, role, !codeNeeded])).rows[0]);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === '23505') throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    if (err.message?.includes('no_instructor')) {
      throw new HttpError(400, 'That name isn’t on the Fall 2026 UMKC class schedule. Enter your name exactly as it appears there.');
    }
    if (err.message?.includes('instructor_claimed')) {
      throw new HttpError(409, 'An account for that instructor already exists. Sign in instead.');
    }
    throw e;
  }
  await withUser(created.user_id, (db) => audit(db, created.user_id, 'signup', { role, rooms: created.rooms }));
  if (codeNeeded) return { ok: true, role, rooms: created.rooms, needCode: true };
  await createSession(created.user_id);
  return { ok: true, role, rooms: created.rooms };
}, { public: true });
