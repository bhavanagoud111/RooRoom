import Link from 'next/link';
import { Logo } from '@/components/ui';

// Sign-in, sign-up and verify: a soft illustrated background fills the page, and the form sits centred on a
// frosted card so it stays readable over it.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-white">
      <img src="/landing/auth-bg.jpg" alt="" aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover object-center" />
      <div className="absolute inset-0 -z-10 bg-white/10" />

      <header className="flex items-center px-6 py-5 sm:px-10">
        <Link href="/" aria-label="RooRoom home" className="rounded-xl bg-white/80 px-3 py-2 shadow-sm backdrop-blur"><Logo size={34} /></Link>
      </header>

      <main className="flex min-h-[calc(100vh-88px)] items-center justify-center px-4 pb-10">
        <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/85 p-7 shadow-xl backdrop-blur-md sm:p-8">
          <p className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-roo-700">University of Missouri–Kansas City</p>
          {children}
        </div>
      </main>
    </div>
  );
}
