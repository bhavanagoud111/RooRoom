import { requireMe } from '@/lib/auth';
import { CalendarApp } from './CalendarApp';

export default async function CalendarPage() {
  const me = await requireMe();
  return <CalendarApp name={me.display_name} lang={me.preferred_language} timezone={me.timezone} role={me.role} />;
}
