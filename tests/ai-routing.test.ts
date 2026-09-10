import assert from 'node:assert/strict';
import test from 'node:test';
import { selectModelGroup } from '../src/ai-routing.js';

process.env.OMNIROUTE_GROUP_STUDY = 'study-combo';
process.env.OMNIROUTE_GROUP_DEFAULT = 'default-combo';

test('prefers section-specific OmniRoute group', () => {
  assert.equal(selectModelGroup('study', 'FREE'), 'study-combo');
});

test('uses default group for non-PRO plans when section group is absent', () => {
  delete process.env.OMNIROUTE_GROUP_CASES;
  assert.equal(selectModelGroup('cases', 'PLUS'), 'default-combo');
});

test('lets PRO fall back to OmniRoute gateway auto/default when no group is configured', () => {
  delete process.env.OMNIROUTE_GROUP_ADMIN;
  assert.equal(selectModelGroup('admin', 'PRO'), undefined);
});
