import { ForgotForm } from '../AuthForms';

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email = '' } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">Forgot your password?</h1>
      <p className="mb-6 text-sm text-ink-mute">Enter your university email and we’ll send you a code to reset it.</p>
      <ForgotForm initialEmail={email.slice(0, 120)} />
    </>
  );
}
