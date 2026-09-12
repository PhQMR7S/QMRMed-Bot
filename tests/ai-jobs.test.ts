import test from 'node:test';
import assert from 'node:assert/strict';
import { isTerminalJobStatus } from '../src/ai-jobs.js';

test('job terminal states are explicit', () => {
  assert.equal(isTerminalJobStatus('COMPLETED'), true);
  assert.equal(isTerminalJobStatus('FAILED'), true);
  assert.equal(isTerminalJobStatus('CANCELLED'), true);
  assert.equal(isTerminalJobStatus('QUEUED'), false);
  assert.equal(isTerminalJobStatus('RUNNING'), false);
});
