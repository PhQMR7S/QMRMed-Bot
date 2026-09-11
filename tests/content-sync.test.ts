import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  chunkText,
  contentKind,
  metadataFromPath,
  normalizeFolderName,
  normalizeStage,
  normalizedSegments,
  shouldIndexPath,
} from '../src/content-sync.js';

test('folder normalization removes numeric prefixes without changing names', () => {
  assert.equal(normalizeFolderName('02 - Sources'), 'Sources');
  assert.deepEqual(normalizedSegments('Medicine/03 - Cardiology/02 - Sources/file.pdf'), ['Medicine', 'Cardiology', 'Sources', 'file.pdf']);
});

test('stage parsing supports English and Arabic folder names', () => {
  assert.equal(normalizeStage('Stage 4'), '4');
  assert.equal(normalizeStage('Year-6'), '6');
  assert.equal(normalizeStage('مرحلة 3'), '3');
  assert.equal(normalizeStage('سنة_2'), '2');
  assert.equal(normalizeStage('Cardiology'), null);
});

test('Drive paths map to department, stage, subject and content kind', () => {
  const path = 'Medicine/Stage 4/Cardiology/01 - Sources/Arrhythmias.pdf';
  assert.deepEqual(metadataFromPath(path), {
    department: 'Medicine',
    stage: '4',
    subjectName: 'Cardiology',
  });
  assert.equal(contentKind(path), 'SOURCE');
  assert.equal(contentKind('صيدلة/مرحلة 3/Pharmacology/وزاريات/2024.pdf'), 'MINISTERIAL');
  assert.equal(contentKind('طب أسنان/Stage 5/Oral Surgery/بنك الأسئلة/questions.pdf'), 'QUESTION');
  assert.equal(contentKind('Medicine/Stage 2/Anatomy/Shared References/book.pdf'), 'REFERENCE');
});

test('excluded Drive folders never become indexable', () => {
  assert.equal(shouldIndexPath('Medicine/Stage 4/02 - Review/Cardiology/Sources/file.pdf'), false);
  assert.equal(shouldIndexPath('Medicine/Stage 4/Cardiology/99 - System/file.pdf'), false);
  assert.equal(shouldIndexPath('Medicine/Stage 4/Cardiology/Sources/file.pdf'), true);
});

test('chunking normalizes whitespace and keeps useful text boundaries', () => {
  const chunks = chunkText('A\r\n\r\n\r\nB C D E F G H', 5);
  assert.deepEqual(chunks, ['A\n\nB', 'C D E', 'F G H']);
  assert.equal(chunkText('   \n\n ', 100).length, 0);
  assert.throws(() => chunkText('text', 0), /greater than zero/);
});
