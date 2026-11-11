// Pure markdown clean-ups for model output; no server imports, so they can be unit-tested.

/** A heading with nothing under it (for example when a reply is cut off) is removed. */
export function dropEmptyHeadings(md: string): string {
  const lines = md.split('\n');
  const isHeading = (l: string) => /^#{1,6}\s/.test(l);
  const kept = lines.filter((l, i) => {
    if (!isHeading(l)) return true;
    const next = lines.slice(i + 1).find((x) => x.trim());
    return next !== undefined && !isHeading(next);
  });
  return kept.join('\n').trimEnd();
}

/** Formulas are not text: swap each $…$ / $$…$$ for a [[Mn]] marker before translating, then restore it. */
export function maskMath(text: string): { masked: string; math: string[] } {
  const math: string[] = [];
  const masked = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m) => `[[M${math.push(m) - 1}]]`);
  return { masked, math };
}
export function unmaskMath(text: string, math: string[]): string {
  return text.replace(/\[\[M(\d+)\]\]/g, (m, i) => math[Number(i)] ?? m);
}
