import { SignupForm } from '../AuthForms';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">Join RooRoom</h1>
      <p className="mb-6 text-sm text-ink-mute">Create your account with your university email.</p>
      <SignupForm initialRole={as === 'professor' ? 'professor' : 'student'} />
    </>
  );
}
