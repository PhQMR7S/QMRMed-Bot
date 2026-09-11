import { strict as assert } from 'node:assert';
import test from 'node:test';
import { hasSufficientGroundedContext } from '../src/ai.js';

test('grounded context requires meaningful content by default', () => {
  assert.equal(hasSufficientGroundedContext('   '), false);
  assert.equal(hasSufficientGroundedContext('a'.repeat(999)), false);
  assert.equal(hasSufficientGroundedContext('a'.repeat(1_000)), true);
});

test('grounded context threshold can be customized', () => {
  assert.equal(hasSufficientGroundedContext('12345', 5), true);
  assert.equal(hasSufficientGroundedContext('1234', 5), false);
  assert.equal(hasSufficientGroundedContext('  12345  ', 5), true);
});
