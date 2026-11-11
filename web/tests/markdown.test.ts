import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropEmptyHeadings } from '../src/lib/markdown.ts';

test('headings with content stay; empty ones go', () => {
  const md = 'Intro\n\n## Key ideas\n\n- a\n\n## Key formulas\n\n## Check yourself\n1. q\n\n## Tail\n';
  assert.equal(dropEmptyHeadings(md), 'Intro\n\n## Key ideas\n\n- a\n\n\n## Check yourself\n1. q');
});

import { maskMath, unmaskMath } from '../src/lib/markdown.ts';

test('formulas are masked for translation and restored exactly', () => {
  const src = 'With $\\alpha = 0.125$ and\n$$x = \\frac{a}{b}$$\ndone';
  const { masked, math } = maskMath(src);
  assert.equal(masked, 'With [[M0]] and\n[[M1]]\ndone');
  assert.equal(unmaskMath(masked.replace('With', 'Con').replace('done', 'listo'), math), src.replace('With', 'Con').replace('done', 'listo'));
});
