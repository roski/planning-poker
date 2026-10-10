import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('distribution is one self-contained HTML with no external scripts, styles or fonts', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert(!/<script\b[^>]*\bsrc\s*=/i.test(html));
  assert(!/<link\b[^>]*rel=["']stylesheet/i.test(html));
  assert(!/@import\s/i.test(html));
  assert(!html.includes('APP_SCRIPT'));
  assert(html.includes('THIRD_PARTY_NOTICES') === false);
  assert(html.includes('MIT License'));
  assert(html.includes('prefers-reduced-motion'));
  assert(Buffer.byteLength(html) < 270_000);
});
