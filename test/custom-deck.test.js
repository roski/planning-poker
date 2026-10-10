import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeCardInput } from '../src/core.js';
test('commas commit complete cards and retain an unfinished value', () => {
  assert.deepEqual(consumeCardInput([], '1, 2, 13'), { values: ['1', '2'], remainder: '13', error: '' });
  assert.deepEqual(consumeCardInput(['1'], '1, ,2,'), { values: ['1', '2'], remainder: '', error: '' });
  assert.deepEqual(consumeCardInput(['1'], '13', true), { values: ['1', '13'], remainder: '', error: '' });
});
test('invalid tokens stay editable while valid tokens are accepted', () => {
  const result = consumeCardInput([], '123456789, 2, XL');
  assert.deepEqual(result.values, ['2']);
  assert.equal(result.remainder, '123456789, XL');
  assert.ok(result.error);
  const full = Array.from({length:24}, (_,i) => String(i));
  const limited = consumeCardInput(full, '25,');
  assert.deepEqual(limited.values, full);
  assert.equal(limited.remainder, '25,');
  assert.ok(limited.error);
});
