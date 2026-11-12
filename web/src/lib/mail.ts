import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { randomBytes } from 'crypto';
import { anonymous } from './db';
import { HttpError, newVerificationCode, sha256 } from './auth';

/**
 * One-time codes by email, sent from a Gmail account with an app password
 * (GMAIL_USER, GMAIL_APP_PASSWORD). The app has no direct internet: mail goes through the
 * egress proxy, which allows smtp.gmail.com:465 and nothing else besides OpenRouter.
 *
 * OTP_SKIP_EMAILS (comma-separated) lists accounts that never get a code and are never emailed:
 * the made-up demo accounts and anyone who must be able to sign in during a live demo.
 * With no Gmail settings at all, codes are off and sign-in works as before (local development).
 */

let transport: Transporter | null = null;

export function mailEnabled() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

const skipList = () =>
  new Set((process.env.OTP_SKIP_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

export function skipsCode(email: string) {
  return skipList().has(email.toLowerCase());
}

/** True when signing in to this account needs a code from the inbox. */
export function needsCode(email: string) {
  return mailEnabled() && !skipsCode(email);
}

function getTransport() {
  if (!transport) {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '') },
      ...(proxy ? { proxy } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

const WHY = {
  login: { subject: 'Your RooRoom sign-in code', line: 'Use this code to finish signing in to RooRoom.' },
  reset: { subject: 'Your RooRoom password reset code', line: 'Use this code to choose a new RooRoom password.' },
} as const;

export async function sendCodeEmail(to: string, code: string, purpose: keyof typeof WHY) {
  const { subject, line } = WHY[purpose];
  const text = `${line}\n\n${code}\n\nThe code works for 10 minutes. If you didn't ask for it, you can ignore this email; ` +
    `someone may have typed your address by mistake.\n\n— RooRoom (UMKC)`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;color:#1e293b">
<p>${line}</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${code}</p>
<p style="color:#64748b;font-size:13px">The code works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>
<p style="color:#64748b;font-size:13px">— RooRoom (UMKC)</p></div>`;
  await getTransport().sendMail({
    from: { name: 'RooRoom', address: process.env.GMAIL_USER! },
    to,
    subject: `${subject}: ${code}`,
    text,
    html,
  });
}

/** "b•••y@umkc.edu", so the page can say where the code went without printing the whole address. */
export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  const shown = name.length <= 2 ? name[0] : `${name[0]}${'•'.repeat(Math.min(name.length - 2, 5))}${name.at(-1)}`;
  return `${shown}@${domain}`;
}

/**
 * Stores a code and emails it. Returns the challenge token for a sign-in code (it ties the code
 * to the password step that asked for it). 'reused' means a code went out less than a minute ago;
 * that one still works and nothing new is sent.
 */
export async function issueCode(userId: string, email: string, purpose: 'login' | 'reset') {
  const code = newVerificationCode();
  const challenge = purpose === 'login' ? randomBytes(24).toString('base64url') : null;
  const r = await anonymous((db) => db.query('SELECT auth_code_issue($1, $2, $3, $4) AS s',
    [userId, purpose, sha256(code), challenge ? sha256(challenge) : null]));
  const status = r.rows[0].s as 'send' | 'reused' | 'too_many';
  if (status === 'too_many') {
    throw new HttpError(429, 'Too many codes were sent to this address in the last hour. Try again later.');
  }
  if (status === 'send') {
    try {
      await sendCodeEmail(email, code, purpose);
    } catch (e) {
      console.error('[mail]', (e as Error).message);
      throw new HttpError(503, 'We couldn’t send the email just now. Please try again in a minute.');
    }
  }
  return { challenge, status };
}
