'use client';
import { useEffect, useState } from 'react';

/** Formats a timestamp in the viewer's own time zone (after hydration, to avoid a mismatch). */
export function When({ iso, mode = 'datetime' }: { iso: string | null; mode?: 'datetime' | 'date' | 'relative' }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (mode === 'relative') {
      const s = Math.round((Date.now() - d.getTime()) / 1000);
      setText(s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`);
    } else if (mode === 'date') {
      setText(d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    } else {
      setText(d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    }
  }, [iso, mode]);
  return <time dateTime={iso ?? undefined} suppressHydrationWarning>{text}</time>;
}
