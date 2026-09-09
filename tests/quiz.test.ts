import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseInButtonQuiz, isAnswerCorrect, isQuizExpired, resolveSelectedValue } from '../src/quiz.js';

test('resolves array options by callback index', () => {
  const question = { type: 'MCQ' as const, options: ['A', 'B', 'C'], answer: 'B' };
  assert.equal(resolveSelectedValue(question, '1'), 'B');
  assert.equal(isAnswerCorrect(question, '1'), true);
});

test('resolves object options by callback key', () => {
  const question = { type: 'MCQ' as const, options: { A: 'Apple', B: 'Banana' }, answer: 'Banana' };
  assert.equal(resolveSelectedValue(question, 'B'), 'Banana');
  assert.equal(isAnswerCorrect(question, 'B'), true);
  assert.equal(isAnswerCorrect(question, 'A'), false);
});

test('supports true/false button questions without options', () => {
  assert.equal(canUseInButtonQuiz({ type: 'TRUE_FALSE', answer: 'صحيح' }), true);
  assert.equal(isAnswerCorrect({ type: 'TRUE_FALSE', answer: 'صحيح' }, 'صحيح'), true);
  assert.equal(isAnswerCorrect({ type: 'TRUE_FALSE', answer: 'true' }, 'صحيح'), true);
  assert.equal(isAnswerCorrect({ type: 'TRUE_FALSE', answer: 'false' }, 'صحيح'), false);
});

test('excludes short-answer questions from button quiz', () => {
  assert.equal(canUseInButtonQuiz({ type: 'SHORT_ANSWER', answer: 'x' }), false);
});

test('enforces the 15 minute exam boundary', () => {
  const startedAt = 1_000_000;
  const session = { ids: [1], index: 0, correct: 0, exam: true, startedAt };
  assert.equal(isQuizExpired(session, startedAt + 15 * 60_000 - 1), false);
  assert.equal(isQuizExpired(session, startedAt + 15 * 60_000), true);
});

test('non-exam training sessions never expire by exam timer', () => {
  const session = { ids: [1], index: 0, correct: 0, exam: false, startedAt: 0 };
  assert.equal(isQuizExpired(session, 10_000_000), false);
});
