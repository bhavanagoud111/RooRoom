'use client';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// AI output is rendered as markdown with raw HTML dropped (skipHtml) and no rehype-raw.
// Links that are not inside the app are rendered as plain text, and images are never loaded.
// The server has already stripped outside links (egress.ts); this is the second layer.
// Formulas ($…$ inline, $$…$$ on their own line) are typeset by KaTeX with trust off, so
// \href, \url and \includegraphics cannot create links or load anything.

function inApp(href?: string) {
  return !!href && href.startsWith('/') && !href.startsWith('//');
}

/** Models also write \( … \) and \[ … \]; turn them into the $ forms remark-math reads. */
export function normaliseMath(text: string) {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`)
    // A line that starts with $$…$$ (often followed by its explanation) becomes a centred display
    // formula, with any explanation as its own paragraph underneath.
    .replace(/^[ \t]*\$\$([^$\n]+)\$\$[ \t]*(.*)$/gm, (_, m, rest) => `\n$$\n${m.trim()}\n$$\n${rest.trim() ? `\n${rest.trim()}\n` : ''}`);
}

/** Remove inline [n] citation markers; sources are listed once below the answer instead. */
export function stripCitations(text: string) {
  return text.replace(/ ?(\[\d{1,2}\])+(?!\()/g, '');
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? 'prose-rr'}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[[remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' }]]}
        components={{
          a: ({ href, children }) => (inApp(href) ? <a href={href}>{children}</a> : <span>{children}</span>),
          img: ({ alt }) => <span className="text-ink-mute">[image: {alt || 'removed'}]</span>,
        }}
      >
        {normaliseMath(text)}
      </ReactMarkdown>
    </div>
  );
}
