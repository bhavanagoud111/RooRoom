'use client';
// Voice typing for any text box: click the mic, speak English, and the words are typed into the box
// (added after anything already there). Uses the browser's own speech recognition, so nothing is
// sent to RooRoom until the person presses Send. Works in Chrome, Edge and Safari.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Mic, MicOff } from 'lucide-react';

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecCtor = new () => Rec;

function recognizer(): RecCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the address bar.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in the address bar.',
  'no-speech': 'I didn’t hear anything. Try again.',
  network: 'The speech service couldn’t be reached.',
  'audio-capture': 'No microphone was found.',
};

/**
 * value/onChange: the text box's own state. onFinal: called with what was heard when listening
 * stops (used where speech picks an option instead of typing). variant "inline" is a small icon
 * for inside a box (see ComposeTools); "button" is a square button beside it.
 */
export function VoiceButton({ value = '', onChange, onFinal, variant = 'button', className, label = 'Speak (English)' }: {
  value?: string; onChange?: (v: string) => void; onFinal?: (heard: string) => void;
  variant?: 'inline' | 'button'; className?: string; label?: string;
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<Rec | null>(null);
  const baseRef = useRef('');
  const heardRef = useRef('');

  useEffect(() => { setSupported(!!recognizer()); return () => recRef.current?.abort(); }, []);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 5000); return () => clearTimeout(t); }, [err]);

  function toggle() {
    if (listening) { recRef.current?.stop(); return; }
    const Ctor = recognizer();
    if (!Ctor) { setErr('Voice typing works in Chrome, Edge and Safari.'); return; }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    baseRef.current = value && !/\s$/.test(value) ? `${value} ` : value;
    heardRef.current = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heardRef.current = text.trim();
      onChange?.(baseRef.current + heardRef.current);
    };
    rec.onerror = (e) => { if (e.error !== 'aborted') setErr(MESSAGES[e.error] ?? 'Voice typing isn’t working here. You can type instead.'); };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (heardRef.current) onFinal?.(heardRef.current);
    };
    recRef.current = rec;
    setErr(null);
    try { rec.start(); setListening(true); } catch { setErr('Voice typing couldn’t start. Try again.'); }
  }

  const title = !supported ? 'Voice typing works in Chrome, Edge and Safari' : listening ? 'Stop listening' : label;
  return (
    <span className={clsx('relative inline-flex shrink-0', className)}>
      <button type="button" onClick={toggle} title={title} aria-label={title} aria-pressed={listening}
        className={clsx('relative flex items-center justify-center rounded-lg transition-colors',
          variant === 'inline' ? 'h-8 w-8' : 'h-[42px] w-[42px] border',
          listening ? 'border-red-600 bg-red-600 text-white'
            : variant === 'inline' ? 'text-ink-mute hover:bg-slate-100 hover:text-roo-600' : 'border-line bg-white text-ink-soft hover:bg-slate-50 hover:text-roo-600',
          !supported && 'opacity-50')}>
        {listening && <span className="absolute inset-0 animate-ping rounded-lg bg-red-400/40 motion-reduce:hidden" aria-hidden />}
        {supported ? <Mic className="relative h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
      {listening && <span className="sr-only" role="status">Listening</span>}
      {err && (
        <span role="alert" className="absolute bottom-full right-0 z-20 mb-1 w-56 rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs text-white shadow-lift">
          {err}
        </span>
      )}
    </span>
  );
}

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
};
const STOP = new Set(['the', 'a', 'an', 'for', 'of', 'on', 'to', 'and', 'in', 'make', 'me', 'some', 'flashcards', 'flashcard',
  'cards', 'summary', 'summarise', 'summarize', 'please', 'about', 'from', 'my']);
const words = (s: string) => [...new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  .map((w) => NUMBER_WORDS[w] ?? w).filter((w) => !STOP.has(w)))];

/** Picks the option whose label best matches what was said ("module four" -> "Module 4"). */
export function bestMatch<T extends { value: string; label: string }>(heard: string, options: T[]): T | null {
  const said = words(heard);
  if (!said.length) return null;
  // Rank by share of the shorter phrase matched, then by how exactly the label matched.
  const ranked = options.map((o) => {
    const ws = words(o.label);
    const hits = ws.filter((w) => said.includes(w)).length;
    return { o, s: ws.length ? hits / Math.min(ws.length, said.length) : 0, exact: ws.length ? hits / ws.length : 0 };
  }).sort((a, b) => b.s - a.s || b.exact - a.exact);
  const [top, next] = ranked;
  if (!top || top.s < 0.5) return null;
  // Two equally good matches ("module" -> Module 3 or Module 4?): ask instead of guessing.
  if (next && next.s === top.s && next.exact === top.exact) return null;
  return top.o;
}
