// Flashcard replies carry LaTeX; models often leave its backslashes unescaped in JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../src/lib/json.ts';

test('unescaped LaTeX survives JSON parsing in latex mode', () => {
  const raw = String.raw`{"formula":"\hat\beta_1 = \frac{\sum_i x_i}{n}","set":"\{a\}","ok":"\\frac{1}{2}","q":"a\"b"}`;
  const r = parseJson<Record<string, string>>(raw, { latex: true });
  assert.equal(r.formula, String.raw`\hat\beta_1 = \frac{\sum_i x_i}{n}`);
  assert.equal(r.set, String.raw`\{a\}`);
  assert.equal(r.ok, String.raw`\frac{1}{2}`);
  assert.equal(r.q, 'a"b');
});

test('normal mode is unchanged', () => {
  assert.deepEqual(parseJson('```json\n{"a":"x\\ny"}\n```'), { a: 'x\ny' });
});

test('a reply cut off mid-card keeps the complete cards', () => {
  const raw = '{"cards":[{"front":"A","back":"1"},{"front":"B","back":"2"},{"front":"C","ba';
  const r = parseJson<{ cards: { front: string }[] }>(raw, { latex: true });
  assert.deepEqual(r.cards.map((c) => c.front), ['A', 'B']);
});
