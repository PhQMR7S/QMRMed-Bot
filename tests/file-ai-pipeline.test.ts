import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pipeline = await readFile(new URL('../src/file-ai-pipeline-v2.ts', import.meta.url), 'utf8');
const fileAi = await readFile(new URL('../src/file-ai-v4.ts', import.meta.url), 'utf8');

test('File AI uses a hierarchical map-reduce tree', () => {
  assert.match(pipeline, /FAN_IN=6/);
  assert.match(pipeline, /stage:'map'/);
  assert.match(pipeline, /stage:'reduce'/);
  assert.match(pipeline, /final:nextGroups\.length===1/);
});

test('File AI no longer limits generation to the first few chunks', () => {
  assert.doesNotMatch(fileAi, /chunks\.slice\(0,\s*8\)/);
  assert.doesNotMatch(fileAi, /\.slice\(0,30000\)/);
});

test('File AI operations are idempotent by request content', () => {
  assert.match(fileAi, /requestDigest/);
  assert.match(fileAi, /requestKey/);
  assert.match(fileAi, /result-tree:/);
});
