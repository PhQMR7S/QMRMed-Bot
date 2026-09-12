import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAM_DURATION_MS, remainingExamSeconds } from '../src/exam-sessions.js';

test('exam duration defaults to ten minutes', () => {
  assert.equal(EXAM_DURATION_MS, 600_000);
});

test('remaining exam seconds never becomes negative', () => {
  const expiresAt = new Date('2026-09-12T12:10:00Z');
  assert.equal(remainingExamSeconds(expiresAt, new Date('2026-09-12T12:09:59.100Z')), 1);
  assert.equal(remainingExamSeconds(expiresAt, new Date('2026-09-12T12:10:01Z')), 0);
});
