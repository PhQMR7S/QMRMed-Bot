import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDriveFolderId } from '../src/drive.js';

test('normalizeDriveFolderId accepts a raw folder id', () => {
  assert.equal(normalizeDriveFolderId('  abc123  '), 'abc123');
});

test('normalizeDriveFolderId extracts a folder id from a Drive URL', () => {
  assert.equal(
    normalizeDriveFolderId('https://drive.google.com/drive/folders/abc123?usp=sharing'),
    'abc123',
  );
});

test('normalizeDriveFolderId handles encoded folder ids', () => {
  assert.equal(
    normalizeDriveFolderId('https://drive.google.com/drive/folders/a%2Fb'),
    'a/b',
  );
});
