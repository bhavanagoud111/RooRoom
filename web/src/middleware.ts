import { NextResponse, type NextRequest } from 'next/server';

// Every page gets a strict Content Security Policy with a fresh nonce. Scripts run only if they
// carry the nonce, so even if student text ever slipped into the page as HTML, it could not run.
// This is the Canvas lesson: the professor dashboard and report review screens are privileged
// consoles where student-written text meets the most powerful sessions.

const PUBLIC_PATHS = ['/login', '/signup', '/verify', '/api/auth', '/about', '/landing/'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const signedIn = req.cookies.has('rr_session');
  const isPublic = pathname === '/' || PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!signedIn && !isPublic && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:3300';
  const ws = origin.replace(/^http/, 'ws');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${ws}${dev ? ' ws://localhost:3000 ws://localhost:3301' : ''}`,
    `media-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)' }],
};
