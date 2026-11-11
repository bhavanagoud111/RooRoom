import { VerifyForm } from '../AuthForms';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; demo?: string }> }) {
  const { email = '', demo } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold text-ink">Check your inbox</h1>
      <p className="mb-6 text-sm text-ink-mute">Verified university email is required before you can join a course.</p>
      <VerifyForm email={email} demo={demo && /^\d{6}$/.test(demo) ? demo : undefined} />
    </>
  );
}
