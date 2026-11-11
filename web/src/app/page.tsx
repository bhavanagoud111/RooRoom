import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/auth';
import { Landing } from './Landing';

// The signed-out home page. Signed-in users go straight to their dashboard.
export default async function Home() {
  if (await currentUserId()) redirect('/dashboard');
  return <Landing />;
}
