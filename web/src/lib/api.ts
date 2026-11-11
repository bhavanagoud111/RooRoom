import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { HttpError, apiMe, type Me } from './auth';
import { LlmError } from './llm';
import { PUBLIC_ORIGIN } from './config';

type Handler<P> = (req: NextRequest, ctx: { me: Me; params: P }) => Promise<Response | unknown>;

/**
 * Wraps an API route: requires a session, rejects cross-site writes, and turns errors into
 * plain-English JSON. Internal error details are logged, never sent to the browser.
 */
export function route<P = Record<string, string>>(handler: Handler<P>, opts: { public?: boolean } = {}) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') checkOrigin(req);
      const me = opts.public ? (null as unknown as Me) : await apiMe();
      const params = ctx?.params ? await ctx.params : ({} as P);
      const out = await handler(req, { me, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  if (e instanceof LlmError) {
    console.error('[llm]', e.message);
    return NextResponse.json({ error: 'The AI is unavailable right now. Please try again in a moment.' }, { status: 503 });
  }
  const pgCode = (e as { code?: string })?.code;
  if (pgCode === '42501') {
    // Row Level Security said no.
    return NextResponse.json({ error: 'You do not have access to that.' }, { status: 403 });
  }
  if (pgCode === '23505') return NextResponse.json({ error: 'That already exists.' }, { status: 409 });
  console.error('[api]', e);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

function checkOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  const allowed = new Set([PUBLIC_ORIGIN, 'http://localhost:3300', 'http://127.0.0.1:3300', 'http://localhost:3000']);
  if (origin && !allowed.has(origin)) throw new HttpError(403, 'Cross-site request refused.');
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body.');
  }
  return schema.parse(raw);
}

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(v: string) {
  if (!uuid.test(v)) throw new HttpError(404, 'Not found.');
  return v;
}
