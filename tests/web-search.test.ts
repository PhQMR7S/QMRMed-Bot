import { strict as assert } from 'node:assert';
import test from 'node:test';
import { cleanMedicalMarkdown, isTrustedMedicalUrl } from '../src/web-search.js';

test('trusted medical URLs accept approved HTTPS hosts only', () => {
  assert.equal(isTrustedMedicalUrl('https://www.who.int/news/item'), true);
  assert.equal(isTrustedMedicalUrl('https://pubmed.ncbi.nlm.nih.gov/12345'), true);
  assert.equal(isTrustedMedicalUrl('http://www.who.int/news/item'), false);
  assert.equal(isTrustedMedicalUrl('https://example.com/who.int'), false);
  assert.equal(isTrustedMedicalUrl('not-a-url'), false);
});

test('markdown cleaner removes navigation noise and respects footer/length limits', () => {
  const input = [
    '# Medical topic',
    '',
    'Core clinical content with a [source](https://example.com).',
    '',
    '## References',
    'Reference list that should not be sent to the model.',
  ].join('\n');

  const cleaned = cleanMedicalMarkdown(input, 500);
  assert.equal(cleaned.includes('Core clinical content'), true);
  assert.equal(cleaned.includes('https://example.com'), false);
  assert.equal(cleaned.includes('## References'), false);

  const capped = cleanMedicalMarkdown('# Topic\n\n' + 'x'.repeat(500), 80);
  assert.equal(capped.length <= 80, true);
});
