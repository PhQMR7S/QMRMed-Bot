import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStage } from '../src/content-sync.js';

test('normalizes English stage labels to numeric stage', () => {
  assert.equal(normalizeStage('Stage 4'), '4');
  assert.equal(normalizeStage('Year-2'), '2');
});

test('normalizes Arabic stage labels to numeric stage', () => {
  assert.equal(normalizeStage('مرحلة 3'), '3');
  assert.equal(normalizeStage('سنة-1'), '1');
});

test('returns null when no stage label exists', () => {
  assert.equal(normalizeStage('Pharmacology'), null);
});
