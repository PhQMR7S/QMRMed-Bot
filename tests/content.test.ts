import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRetrievedContext } from '../src/content-search.js';

test('formats retrieved Drive content with source metadata', () => {
  const result = formatRetrievedContext([
    {
      title: 'Nephrotic syndrome',
      text: 'Proteinuria, hypoalbuminemia and edema.',
      kind: 'CASE',
      source: 'Medicine - Renal.pdf',
      driveFileId: 'drive-1',
      department: 'Medicine',
      stage: 'Stage 4',
      subjectName: 'Medicine',
    },
  ]);
  assert.match(result, /\[CASE\]/);
  assert.match(result, /Medicine - Renal\.pdf/);
  assert.match(result, /Proteinuria/);
});

test('does not exceed the requested context size', () => {
  const result = formatRetrievedContext([
    {
      title: 'Long source',
      text: 'x'.repeat(1000),
      kind: 'SOURCE',
      source: 'book.txt',
      driveFileId: 'drive-2',
    },
  ], 200);
  assert.ok(result.length <= 200);
});
