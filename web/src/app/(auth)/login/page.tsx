import { LoginForm } from '../AuthForms';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const { verified } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">Welcome back</h1>
      <p className="mb-6 text-sm text-ink-mute">Sign in with your university account.</p>
      {verified && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Email verified. You can sign in now.</p>}
      <LoginForm />
    </>
  );
}
