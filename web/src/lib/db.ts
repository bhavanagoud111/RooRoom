import 'server-only';
import { Pool, type PoolClient } from 'pg';

// Two pools, two database roles, neither of which can bypass Row Level Security.
//   app       - rooroom_app. Every query runs inside withUser(), as the signed-in user.
//   moderator - rooroom_moderator. Only the clustering, digest and note-delivery pipeline uses it.
//               It can read redacted question text and note authors, nothing about chat or files.

const g = globalThis as unknown as { __rrApp?: Pool; __rrMod?: Pool };

function appPool(): Pool {
  if (!g.__rrApp) g.__rrApp = new Pool({ connectionString: process.env.DATABASE_URL, max: 15 });
  return g.__rrApp;
}
function modPool(): Pool {
  if (!g.__rrMod) g.__rrMod = new Pool({ connectionString: process.env.MODERATOR_DATABASE_URL, max: 5 });
  return g.__rrMod;
}

export type Db = PoolClient;

/** Runs fn in a transaction as the given user. RLS policies read app.user_id. */
export async function withUser<T>(userId: string, fn: (db: Db) => Promise<T>,
  opts: { readOnly?: boolean } = {}): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query(opts.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** For the few calls made before anyone is signed in (login, sign-up). Only definer functions work here. */
export async function anonymous<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', '', true)");
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** The moderation and clustering service. Never called with user-supplied SQL. */
export async function asModerator<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await modPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function vec(v: number[]): string {
  return `[${v.join(',')}]`;
}
