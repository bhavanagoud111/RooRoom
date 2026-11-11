import 'server-only';
import { createHash, randomBytes, randomInt } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { anonymous, withUser } from './db';

export const SESSION_COOKIE = 'rr_session';

export type Me = {
  id: string;
  display_name: string;
  role: 'student' | 'professor';
  preferred_language: string;
  timezone: string;
  visible_to_classmates: boolean;
  email: string | null;
};

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function newVerificationCode() {
  return String(randomInt(100000, 1000000));
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await anonymous((db) => db.query('SELECT auth_create_session($1, $2)', [userId, sha256(token)]));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.PUBLIC_ORIGIN ?? '').startsWith('https'),
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await anonymous((db) => db.query('SELECT auth_revoke_session($1)', [sha256(token)]));
  jar.delete(SESSION_COOKIE);
}

/** Resolves the session cookie to a user id. Sessions expire after 2 hours idle. */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const r = await anonymous((db) => db.query('SELECT auth_resolve_session($1) AS uid', [sha256(token)]));
  return r.rows[0]?.uid ?? null;
}

export async function getMe(): Promise<Me | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  return withUser(uid, async (db) => {
    const r = await db.query(
      `SELECT id, display_name, role, preferred_language, timezone, visible_to_classmates
         FROM profiles WHERE id = $1`, [uid]);
    if (!r.rows[0]) return null;
    return { ...r.rows[0], email: null } as Me;
  });
}

/** For pages: redirect to /login when signed out. */
export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/login');
  return me;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For API routes: throw 401 when signed out. */
export async function apiMe(): Promise<Me> {
  const me = await getMe();
  if (!me) throw new HttpError(401, 'Please sign in again.');
  return me;
}
