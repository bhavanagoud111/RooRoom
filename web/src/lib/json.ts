// Pure helpers for reading model replies; no server imports, so they can be unit-tested.

/** Parses a JSON object out of a model reply, tolerating code fences.
 *  With latex, single backslashes before LaTeX commands (\\frac, \\beta, \\{ …) are doubled first:
 *  models often forget to escape them, which either breaks the JSON or silently turns \\frac
 *  into a form feed. Only used where the reply is meant to contain formulas. */
export function parseJson<T>(text: string, opts: { latex?: boolean } = {}): T {
  const m = text.match(/\{[\s\S]*\}/);
  let body = m ? m[0] : text;
  if (opts.latex) {
    body = body
      .replace(/(?<!\\)\\(?=[a-zA-Z]{2,})/g, '\\\\')
      .replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\');
  }
  try {
    return JSON.parse(body) as T;
  } catch (e) {
    if (!opts.latex) throw e;
    // A reply cut off by the token limit: keep every complete item of the list.
    for (let i = body.lastIndexOf('}'), n = 0; i > 0 && n < 40; i = body.lastIndexOf('}', i - 1), n++) {
      try { return JSON.parse(body.slice(0, i + 1) + ']}') as T; } catch { /* try an earlier cut */ }
    }
    throw e;
  }
}
