import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEvidence } from '../src/search-engine.js';

test('evidence is insufficient when there are no results', () => {
  assert.equal(assessEvidence([], 'DKA').sufficient, false);
});

test('evidence assessment requires relevance and source authority', () => {
  const result = assessEvidence([
    { title: 'DKA', text: 'diabetic ketoacidosis DKA management', kind: 'SOURCE' as never, source: 'Lecture', driveFileId: '1', webViewLink: 'https://drive.google.com/file/1' },
    { title: 'DKA complications', text: 'DKA dehydration', kind: 'SOURCE' as never, source: 'Lecture 2', driveFileId: '2', webViewLink: 'https://drive.google.com/file/2' },
  ], 'DKA management');
  assert.equal(result.sufficient, true);
  assert.ok(result.relevance > 0);
  assert.ok(result.coverage > 0);
});
