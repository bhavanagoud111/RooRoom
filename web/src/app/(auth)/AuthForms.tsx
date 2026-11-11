'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Spinner } from '@/components/client';

import clsx from 'clsx';
import { GraduationCap, UserRound } from 'lucide-react';

type Role = 'student' | 'professor';


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

export function LoginForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/login', { body: { email, password } });
      // The tab only chooses the screen; the account decides the role. On the wrong tab, sign
      // straight back out and say which tab to use.
      const { me } = await api<{ me: { role: Role } }>('/api/me');
      if (me.role !== role) {
        await api('/api/auth/logout', { body: {} }).catch(() => {});
        setErr(`That is a ${me.role} account. Choose “${me.role === 'student' ? 'Student' : 'Professor'}” above to sign in.`);
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
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/signup', { body: { ...f, role } });
      router.push('/dashboard');
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
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
        <input id="pw" className="input" type="password" autoComplete="new-password" minLength={10} value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })} required />
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Create {role} account</button>
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
