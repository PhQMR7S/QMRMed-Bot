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

test('stage parsing supports numeric, English, and Arabic stage names', () => {
  assert.equal(normalizeStage('Stage 4'), '4');
  assert.equal(normalizeStage('Year-6'), '6');
  assert.equal(normalizeStage('مرحلة 3'), '3');
  assert.equal(normalizeStage('سنة_2'), '2');
  assert.equal(normalizeStage('المرحلة الرابعة'), '4');
  assert.equal(normalizeStage('المرحلة السادسة'), '6');
  assert.equal(normalizeStage('الثانية'), '2');
  assert.equal(normalizeStage('Cardiology'), null);
});

test('canonical Drive paths map department, stage, subject and content kind', () => {
  assert.deepEqual(metadataFromPath('01 - طب بشري/04 - المرحلة الرابعة/Cardiology/01 - المصادر/Arrhythmias.pdf'), {
    department: 'Medicine',
    stage: '4',
    subjectName: 'Cardiology',
  });
  assert.equal(contentKind('01 - طب بشري/04 - المرحلة الرابعة/Cardiology/01 - المصادر/Arrhythmias.pdf'), 'SOURCE');
  assert.equal(contentKind('03 - صيدلة/03 - المرحلة الثالثة/Pharmacology/04 - أسئلة وزارية/2024.pdf'), 'MINISTERIAL');
  assert.equal(contentKind('02 - طب الأسنان/05 - المرحلة الخامسة/Oral Surgery/03 - بنك الأسئلة/questions.pdf'), 'QUESTION');
  assert.equal(contentKind('04 - تمريض/02 - المرحلة الثانية/Medical-Surgical Nursing/02 - المراجع/book.pdf'), 'REFERENCE');
  assert.equal(contentKind('05 - تخدير/01 - المرحلة الأولى/Anesthesia/05 - حالات سريرية/case.pdf'), 'CASE');
});

test('canonical materials hierarchy maps the canonical subject and indexes study files as SOURCE', () => {
  assert.deepEqual(metadataFromPath('01 - طب بشري/01 - المرحلة الأولى/01 - المواد/علم التشريح البشري والأنسجة/lecture.pdf'), {
    department: 'Medicine',
    stage: '1',
    subjectName: 'علم التشريح البشري والأنسجة',
  });
  assert.equal(contentKind('01 - طب بشري/01 - المرحلة الأولى/01 - المواد/علم التشريح البشري والأنسجة/lecture.pdf'), 'SOURCE');
});

test('department aliases normalize across the supported QMRMed programs', () => {
  const cases: Array<[string, string]> = [
    ['صيدلة', 'Pharmacy'],
    ['طب أسنان', 'Dentistry'],
    ['تمريض', 'Nursing'],
    ['تقنيات التخدير', 'Anesthesia'],
    ['تقنيات الأشعة والسونار', 'Radiology'],
    ['تقنيات المختبرات الطبية', 'Medical Laboratory Techniques'],
    ['تقنيات صناعة الأسنان', 'Dental Technology'],
    ['تقنيات العلاج الطبيعي', 'Physiotherapy'],
    ['تقنيات البصريات', 'Optics'],
    ['تقنيات طب الطوارئ', 'Emergency Medical Techniques'],
    ['تقنيات عناية القلب', 'Cardiac Care Techniques'],
  ];

  for (const [folder, expected] of cases) {
    assert.equal(metadataFromPath(`${folder}/المرحلة الأولى/Subject/المصادر/file.pdf`).department, expected);
  }
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
