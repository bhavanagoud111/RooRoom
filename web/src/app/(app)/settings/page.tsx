import { requireMe } from '@/lib/auth';
import { PageHeader, SectionTitle } from '@/components/ui';
import { ProfileForm } from './SettingsClient';

export default async function SettingsPage() {
  const me = await requireMe();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Profile & Settings" description="Profile, language and privacy" />
      <section>
        <SectionTitle title="Your profile" sub="What classmates see, and the language RooRoom speaks to you in." />
        <ProfileForm me={me} />
      </section>
    </div>
  );
}
