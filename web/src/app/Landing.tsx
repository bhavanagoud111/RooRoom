'use client';
// One scrolling page: a hero over the illustration, a sticky feature bar that follows the scroll,
// then one large card per feature with what students can do. Motion is skipped when the visitor
// asks for reduced motion.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowDown, CalendarDays, Check, GraduationCap, MessageCircleQuestion, MessageSquareHeart, Sparkles, Users,
} from 'lucide-react';
import { Logo } from '@/components/ui';

type Feature = {
  id: string; name: string; tagline: string; body: string; icon: typeof Sparkles;
  tint: string; ink: string; can: string[]; who?: string;
};

// Colours follow the illustration: sage, peach, sky and butter.
const FEATURES: Feature[] = [
  {
    id: 'study-ai', name: 'Study AI', icon: Sparkles, tint: 'bg-[#E4EFE6]', ink: 'text-[#3F7A52]',
    tagline: 'An AI tutor that only knows your course.',
    body: 'It reads your professor’s files and published answers, nothing from the open web, and tells you which file and page each answer came from. On graded work it gives hints, never the answer.',
    can: [
      'Ask anything about the course in plain words',
      'Summarise a module into key ideas and key formulas',
      'Flip through flashcards and track what you already know',
      'Translate any answer into your language with one click',
    ],
  },
  {
    id: 'ask', name: 'Ask the Professor', icon: MessageCircleQuestion, tint: 'bg-[#FBE7D6]', ink: 'text-[#B8662E]',
    tagline: 'Ask without raising your hand.',
    body: 'Questions are anonymous and can be written in any language. Similar questions are grouped, and once three students ask, your professor gets one short summary and answers the whole class at once.',
    can: [
      'Ask anonymously, in any language',
      'See if the professor already answered something similar',
      'Get one clear answer that reaches everyone',
      'Abusive words are removed before anything is sent',
    ],
  },
  {
    id: 'feedback', name: 'Anonymous Feedback', icon: MessageSquareHeart, tint: 'bg-[#E3EEF6]', ink: 'text-[#3C6E91]',
    tagline: 'Say it while it can still change something.',
    body: '“Module 3 is moving too fast.” Notes reach your professor without your name, in a daily batch, after a check that stops abuse but lets fair criticism through.',
    can: [
      'Send honest feedback without your name',
      'Read your professor’s reply in the same thread',
      'Notes arrive in a daily batch, so timing gives nothing away',
    ],
  },
  {
    id: 'buddies', name: 'Study Buddies', icon: Users, tint: 'bg-[#FFF3D1]', ink: 'text-[#A67C12]',
    tagline: 'Find the people studying what you’re studying.',
    body: 'See classmates who chose to be visible, what they’re working on and when you’re both free. Chat one-to-one or in a small group without sharing a phone number or email.',
    can: [
      'See who is on the same module this week',
      'Find times you’re both free',
      'Chat one-to-one or in a small group, encrypted',
      'Block or report anyone, any time',
    ],
  },
  {
    id: 'calendar', name: 'Voice Calendar', icon: CalendarDays, tint: 'bg-[#E4EFE6]', ink: 'text-[#3F7A52]',
    tagline: 'Plan your week by talking to it.',
    body: '“Block 9 to 10 tomorrow for the networks project.” Deadlines from your syllabus show up as suggestions before you ask, and it checks with you before it deletes or double-books anything.',
    can: [
      'Add or move events by voice or by typing',
      'Confirm syllabus deadlines with one tap',
      'Hear your day read aloud',
      'Export your calendar to Google or Apple Calendar (.ics)',
    ],
  },
  {
    id: 'professors', name: 'For Professors', icon: GraduationCap, tint: 'bg-[#FBE7D6]', ink: 'text-[#B8662E]',
    tagline: 'Answer once. Reach everyone.', who: 'professors',
    body: 'See what your class is unsure about as a short list of summaries, not an inbox of repeated emails. Upload a syllabus and every student’s calendar picks up the dates.',
    can: [
      'Read grouped question summaries, never names',
      'Publish one answer to the whole class, in every language',
      'Read screened, anonymous feedback and reply',
      'Share course files that the Study AI answers from',
    ],
  },
];

const STEPS = [
  { n: '1', t: 'Join your course', d: 'Search the UMKC catalog and pick your professor’s section.' },
  { n: '2', t: 'Study with your course', d: 'Everything you ask is answered from that course’s own material.' },
  { n: '3', t: 'One answer for everyone', d: 'When the professor answers, the whole class gets it, in each student’s language.' },
];

/** Fades a block in the first time it scrolls into view. */
function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={clsx('transition-all duration-700 ease-out motion-reduce:transition-none', shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0', className)}>
      {children}
    </div>
  );
}

export function Landing() {
  const [active, setActive] = useState(FEATURES[0].id);

  // Scroll-spy: the feature bar highlights the card currently in the middle of the screen.
  useEffect(() => {
    const els = FEATURES.map((f) => document.getElementById(f.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: '-45% 0px -50% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen scroll-smooth bg-[#FBFAF7]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <div className="flex gap-2">
            <Link href="/login" className="btn-ghost">Sign in</Link>
            <Link href="/signup" className="btn-primary">Join your class</Link>
          </div>
        </div>
      </header>

      {/* Hero over the illustration */}
      <section className="relative isolate overflow-hidden bg-gradient-to-b from-[#FBF6EC] to-[#FBFAF7]">
        <div className="mx-auto max-w-6xl px-6 pt-14 text-center">
          <p className="eyebrow">For UMKC students and professors</p>
          <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            Everyone in your class, <span className="text-roo-600">in the same room.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-ink-soft sm:text-lg">
            A study AI that knows your course, anonymous questions your professor answers once for everyone,
            classmates to study with, and a calendar you can talk to.
          </p>
        </div>
        {/* The illustration, cropped to its drawings (its own mock app bar and footer lines are cut off). */}
        <div className="relative mt-6 h-[300px] sm:h-[460px] lg:h-[520px]">
          <img src="/landing/hero.jpg" alt="" aria-hidden
            className="absolute inset-0 h-full w-full object-cover object-[center_32%]" />
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#FBF6EC] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#FBFAF7] to-transparent" />
          <a href="#features" className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/70 bg-white/85 px-4 py-2 text-sm font-medium text-ink-soft shadow-sm backdrop-blur transition-colors hover:text-ink">
            See what you can do <ArrowDown className="h-4 w-4 motion-safe:animate-bounce" />
          </a>
        </div>
      </section>

      {/* Sticky feature bar */}
      <nav id="features" aria-label="Features" className="sticky top-16 z-20 scroll-mt-16 border-y border-line/70 bg-[#FBFAF7]/90 backdrop-blur">
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 py-2">
          {FEATURES.map((f) => (
            <li key={f.id} className="shrink-0">
              <a href={`#${f.id}`} aria-current={active === f.id ? 'true' : undefined}
                className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  active === f.id ? 'bg-ink text-white' : 'text-ink-mute hover:bg-white hover:text-ink')}>
                <f.icon className="h-4 w-4" aria-hidden />{f.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Feature cards */}
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-14">
        {FEATURES.map((f, i) => (
          <section key={f.id} id={f.id} aria-labelledby={`${f.id}-h`} className="scroll-mt-32">
            <Reveal>
              <div className="group grid overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:hover:translate-y-0 md:grid-cols-[1.1fr_1fr]">
                <div className={clsx('relative flex flex-col justify-center p-8 sm:p-10', i % 2 === 1 && 'md:order-2')}>
                  <span className={clsx('flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110 motion-reduce:group-hover:scale-100', f.tint, f.ink)}>
                    <f.icon className="h-6 w-6" aria-hidden />
                  </span>
                  <p className={clsx('mt-5 text-xs font-semibold uppercase tracking-wider', f.ink)}>{f.name}</p>
                  <h2 id={`${f.id}-h`} className="mt-1 text-2xl font-semibold leading-snug text-ink sm:text-3xl">{f.tagline}</h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{f.body}</p>
                </div>
                <div className={clsx('p-8 sm:p-10', f.tint, i % 2 === 1 && 'md:order-1')}>
                  <p className="text-sm font-semibold text-ink">What {f.who ?? 'students'} can do</p>
                  <ul className="mt-4 space-y-3">
                    {f.can.map((c, j) => (
                      <Reveal key={c} delay={120 + j * 80}>
                        <li className="flex items-start gap-3 rounded-xl bg-white/80 px-4 py-3 text-sm text-ink shadow-sm transition-colors hover:bg-white">
                          <span className={clsx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white', f.ink)}>
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          {c}
                        </li>
                      </Reveal>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          </section>
        ))}

        {/* How it works */}
        <section aria-labelledby="how-h" className="pt-8">
          <Reveal>
            <h2 id="how-h" className="text-center text-2xl font-semibold text-ink">How it works</h2>
          </Reveal>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 120}>
                <li className="h-full rounded-2xl border border-line bg-white p-6 shadow-card">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-roo-50 text-sm font-semibold text-roo-700">{s.n}</span>
                  <h3 className="mt-4 text-base font-semibold text-ink">{s.t}</h3>
                  <p className="mt-1 text-sm text-ink-mute">{s.d}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-xs text-ink-mute">
          <Logo size={24} />
          <span>University of Missouri–Kansas City · Hackathon prototype</span>
        </div>
      </footer>
    </div>
  );
}
