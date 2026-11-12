'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Spinner } from '@/components/client';

import clsx from 'clsx';
import { Eye, EyeOff, GraduationCap, UserRound } from 'lucide-react';

type Role = 'student' | 'professor';

/** Password box with an eye button that shows or hides what is typed. */
function PasswordInput({ id, value, onChange, autoComplete, minLength, invalid }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number; invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} className={clsx('input pr-11', invalid && 'border-red-400 focus:border-red-500')} type={show ? 'text' : 'password'}
        autoComplete={autoComplete} minLength={minLength} value={value} onChange={(e) => onChange(e.target.value)} required />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-mute hover:text-ink">
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}


/** "Are you a student or professor?" with two tabs; used on sign-in and sign-up. */
function RolePicker({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-ink">Are you a student or professor?</p>
      <div className="grid grid-cols-2 rounded-lg border border-line bg-white p-1" role="tablist" aria-label="Account type">
        {(['student', 'professor'] as const).map((r) => {
          const Icon = r === 'student' ? UserRound : GraduationCap;
          return (
            <button key={r} type="button" role="tab" aria-selected={role === r} onClick={() => onChange(r)}
              className={clsx('flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors',
                role === r ? 'bg-roo-600 text-white' : 'text-ink-mute hover:bg-slate-50 hover:text-ink')}>
              <Icon className="h-4 w-4" aria-hidden />{r === 'student' ? 'Student' : 'Professor'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type CodeChallenge = { challenge: string; sentTo: string; reused?: boolean };
type LoginReply = { ok?: boolean; needCode?: boolean } & Partial<CodeChallenge>;

/**
 * Second step of sign-in: the 6-digit code emailed to the account. "Send a new code" repeats the
 * password step (the server re-uses a code sent under a minute ago instead of sending another).
 */
function CodeStep({ email, password, role, first, onBack }: {
  email: string; password: string; role: Role; first: CodeChallenge; onBack: () => void;
}) {
  const router = useRouter();
  const [ch, setCh] = useState<CodeChallenge>(first);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setInfo(null);
    try {
      await api('/api/auth/login/code', { body: { email, challenge: ch.challenge, code } });
      router.push('/dashboard');
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await api<LoginReply>('/api/auth/login', { body: { email, password, role } });
      if (r.challenge) setCh({ challenge: r.challenge, sentTo: r.sentTo ?? ch.sentTo });
      setInfo(r.reused ? 'A code was sent less than a minute ago. Use that one, or wait a minute and ask again.' : 'New code sent. Use the newest email.');
      setCode('');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-soft">
        We emailed a 6-digit code to <strong>{ch.sentTo}</strong>. It works for 10 minutes. Check Junk if you don’t see it.
      </p>
      <input className="input text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="6-digit code" autoFocus required />
      {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{info}</p>}
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy && <Spinner />}Verify and sign in</button>
      <div className="flex justify-between text-sm">
        <button type="button" className="font-semibold text-roo-600 hover:underline" onClick={onBack} disabled={busy}>← Back</button>
        <button type="button" className="font-semibold text-roo-600 hover:underline" onClick={resend} disabled={busy}>Send a new code</button>
      </div>
    </form>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState<CodeChallenge | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // The tab only chooses the screen; the account decides the role. The server refuses the
      // wrong tab (before any code is emailed) and says which tab to use.
      const r = await api<LoginReply>('/api/auth/login', { body: { email, password, role } });
      if (r.needCode && r.challenge) {
        setCode({ challenge: r.challenge, sentTo: r.sentTo ?? email });
        setBusy(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  if (code) return <CodeStep email={email} password={password} role={role} first={code} onBack={() => setCode(null)} />;

  return (
    <div className="space-y-6">
      <RolePicker role={role} onChange={(r) => { setRole(r); setErr(null); }} />
      <form id="login-panel" role="tabpanel" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">University email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@umkc.edu" required />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="pw">Password</label>
            <Link className="text-xs font-semibold text-roo-600 hover:underline" href={`/forgot${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Forgot password?</Link>
          </div>
          <PasswordInput id="pw" autoComplete="current-password" value={password} onChange={setPassword} />
        </div>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}{role === 'student' ? 'Sign in as student' : 'Sign in as professor'}</button>
        <p className="text-center text-sm text-ink-mute">
          New here? <Link className="font-semibold text-roo-600 hover:underline" href={`/signup?as=${role}`}>Create a {role} account</Link>
        </p>
      </form>
    </div>
  );
}

export function SignupForm({ initialRole = 'student' }: { initialRole?: Role }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [f, setF] = useState({ email: '', password: '', displayName: '' });
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== f.password;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<CodeChallenge | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== confirm) { setErr('The two passwords don’t match.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const made = await api<{ needCode?: boolean }>('/api/auth/signup', { body: { ...f, role } });
      if (made.needCode) {
        // Account created; prove the email address with a code before the first sign-in.
        const r = await api<LoginReply>('/api/auth/login', { body: { email: f.email, password: f.password, role } });
        if (r.challenge) { setCode({ challenge: r.challenge, sentTo: r.sentTo ?? f.email }); setBusy(false); return; }
      }
      router.push('/dashboard');
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  if (code) {
    return <CodeStep email={f.email.trim().toLowerCase()} password={f.password} role={role} first={code}
      onBack={() => router.push('/login')} />;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <RolePicker role={role} onChange={(r) => { setRole(r); setErr(null); }} />
      <div>
        <label className="label" htmlFor="name">{role === 'student' ? 'Display name (what classmates see)' : 'Your name, as on the UMKC class schedule'}</label>
        <input id="name" className="input" value={f.displayName} maxLength={60} placeholder={role === 'professor' ? 'e.g. Rafida Zaman' : ''}
          onChange={(e) => setF({ ...f, displayName: e.target.value })} required />
        {role === 'professor' && <p className="mt-1 text-xs text-ink-mute">Your account is linked to the Fall 2026 courses listed under this name.</p>}
      </div>
      <div>
        <label className="label" htmlFor="email">University email</label>
        <input id="email" className="input" type="email" value={f.email} placeholder="you@umkc.edu"
          onChange={(e) => setF({ ...f, email: e.target.value })} required />
      </div>
      <div>
        <label className="label" htmlFor="pw">Password (10+ characters)</label>
        <PasswordInput id="pw" autoComplete="new-password" minLength={10} value={f.password}
          onChange={(v) => setF({ ...f, password: v })} />
      </div>
      <div>
        <label className="label" htmlFor="pw2">Confirm password</label>
        <PasswordInput id="pw2" autoComplete="new-password" value={confirm} onChange={setConfirm} invalid={mismatch} />
        {mismatch && <p className="mt-1 text-xs text-red-600">The passwords don’t match yet.</p>}
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || mismatch}>{busy && <Spinner />}Create {role} account</button>
      <p className="text-center text-sm text-ink-mute">
        Have an account? <Link className="font-semibold text-roo-600 hover:underline" href="/login">Sign in</Link>
      </p>
    </form>
  );
}

export function VerifyForm({ email, demo }: { email: string; demo?: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/verify', { body: { email, code } });
      router.push('/login?verified=1');
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-soft">We sent a 6-digit code to <strong>{email}</strong>.</p>
      {demo && (
        <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-700">
          Demo mode: RooRoom never sends email itself, so the code is shown here: <strong className="text-base tracking-widest">{demo}</strong>
        </p>
      )}
      <input className="input text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Verification code" required />
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy && <Spinner />}Verify</button>
    </form>
  );
}

/**
 * Forgot password. Step 1 emails a 6-digit code (the answer is the same whether or not the
 * account exists). Step 2 takes the code and the new password, which signs out every device.
 */
export function ForgotForm({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== pw;
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setErr(null); setInfo(null);
    try {
      await api('/api/auth/forgot', { body: { email } });
      if (step === 'code') setInfo('If a new code was due, it’s on its way. Use the newest email.');
      setStep('code');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== confirm) { setErr('The two passwords don’t match.'); return; }
    setBusy(true); setErr(null); setInfo(null);
    try {
      await api('/api/auth/reset', { body: { email, code, password: pw } });
      setStep('done');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  }

  if (step === 'done') {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Your password is changed. Sign in with the new one.</p>
        <Link className="btn-primary w-full" href="/login">Go to sign in</Link>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <form onSubmit={reset} className="space-y-4">
        <p className="text-sm text-ink-soft">
          If <strong>{email}</strong> has a RooRoom account, we emailed it a 6-digit code. It works for 10 minutes. Check Junk if you don’t see it.
        </p>
        <div>
          <label className="label" htmlFor="code">Code from the email</label>
          <input id="code" className="input text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
        </div>
        <div>
          <label className="label" htmlFor="pw">New password (10+ characters)</label>
          <PasswordInput id="pw" autoComplete="new-password" minLength={10} value={pw} onChange={setPw} />
        </div>
        <div>
          <label className="label" htmlFor="pw2">Confirm new password</label>
          <PasswordInput id="pw2" autoComplete="new-password" value={confirm} onChange={setConfirm} invalid={mismatch} />
          {mismatch && <p className="mt-1 text-xs text-red-600">The passwords don’t match yet.</p>}
        </div>
        {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{info}</p>}
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || code.length !== 6 || mismatch || pw.length < 10}>{busy && <Spinner />}Change password</button>
        <div className="flex justify-between text-sm">
          <button type="button" className="font-semibold text-roo-600 hover:underline" onClick={() => setStep('email')} disabled={busy}>← Back</button>
          <button type="button" className="font-semibold text-roo-600 hover:underline" onClick={() => send()} disabled={busy}>Send a new code</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">University email</label>
        <input id="email" className="input" type="email" autoComplete="email" value={email} placeholder="you@umkc.edu"
          onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Send reset code</button>
      <p className="text-center text-sm text-ink-mute">
        Remembered it? <Link className="font-semibold text-roo-600 hover:underline" href="/login">Sign in</Link>
      </p>
    </form>
  );
}
