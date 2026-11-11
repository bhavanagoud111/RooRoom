import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Chat messages and anonymous notes are encrypted here, in the app, with a key that lives
// only in the app's environment. A stolen database dump alone does not expose them.

function key(): Buffer {
  const k = Buffer.from(process.env.CONTENT_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('CONTENT_KEY must be 32 bytes, base64');
  return k;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

export function open(sealed: string | null): string {
  if (!sealed) return '';
  const [v, iv, tag, body] = sealed.split(':');
  if (v !== 'v1') return '[unreadable]';
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '[unreadable]';
  }
}

/** Short-lived signed ticket so the chat server can trust who is connecting. */
export function chatTicket(userId: string, ttlSeconds = 60): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  const sig = createHmac('sha256', process.env.CHAT_TICKET_SECRET ?? '').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Encrypts a file (chat attachments) with the same key: 12-byte IV + 16-byte tag + ciphertext. */
export function sealBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function openBuffer(sealed: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key(), sealed.subarray(0, 12));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}
