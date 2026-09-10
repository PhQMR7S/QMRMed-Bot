import assert from 'node:assert/strict';
import test from 'node:test';

function retrievalFilters(department?: string, stage?: string) {
  return {
    ...(department ? { department } : {}),
    ...(stage ? { stage } : {}),
  };
}

test('study profile produces both department and stage filters', () => {
  assert.deepEqual(retrievalFilters('Dentistry', '1'), { department: 'Dentistry', stage: '1' });
});

test('unset study profile leaves retrieval unfiltered', () => {
  assert.deepEqual(retrievalFilters(undefined, undefined), {});
});
