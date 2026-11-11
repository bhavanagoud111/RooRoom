// EGRESS: allowlist.
// Before any AI answer is shown, links and images that point outside RooRoom are removed,
// so a planted instruction cannot smuggle data out inside a URL (for example an image whose
// address carries the conversation in its query string).

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);

function originHost(): string | null {
  try {
    return new URL(process.env.PUBLIC_ORIGIN ?? '').hostname;
  } catch {
    return null;
  }
}

function allowed(url: string): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true; // relative link inside the app
  try {
    const u = new URL(url);
    const host = u.hostname;
    return host === originHost() || ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

export type EgressResult = { text: string; removed: string[] };

export function stripOutsideLinks(markdown: string): EgressResult {
  const removed: string[] = [];
  let text = markdown;
  // Markdown images: never allowed unless inside the app.
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) => {
    if (allowed(url)) return m;
    removed.push(url);
    return `[image removed: points outside RooRoom]`;
  });
  // Markdown links: keep the words, drop the address.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, label, url) => {
    if (allowed(url)) return m;
    removed.push(url);
    return `${label} [link removed]`;
  });
  // Reference-style definitions and bare URLs.
  text = text.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, (m) => {
    removed.push(m.trim());
    return '';
  });
  text = text.replace(/\b(?:https?|ftp|data|javascript):[^\s)<>"']+/gi, (url) => {
    if (allowed(url)) return url;
    removed.push(url);
    return '[link removed]';
  });
  // Raw HTML never survives either; the renderer also drops it.
  text = text.replace(/<\/?(img|iframe|script|a|svg|object|embed|link|style)[^>]*>/gi, (m) => {
    removed.push(m);
    return '';
  });
  return { text, removed };
}
