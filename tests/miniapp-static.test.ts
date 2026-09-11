import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function text(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

test('Mini App loads runtime and keeps the working shell independent of API readiness', async () => {
  const html = await text('miniapp/index.html');
  const runtime = await text('miniapp/runtime.js');

  const runtimeScript = html.indexOf('src="/miniapp/runtime.js');

  assert.notEqual(runtimeScript, -1, 'runtime.js must be loaded by the Mini App');
  assert.match(runtime, /function render\(\)/, 'runtime must contain the render implementation');
  assert.match(runtime, /render\(\);/, 'runtime must initialize the first render');
  assert.match(runtime, /loadUser\(\);/, 'runtime must load user data after the initial render');
  assert.match(runtime, /loadPlans\(\);/, 'runtime must load plans after the initial render');
  assert.match(runtime, /api\('\/api\/me'\)/, 'runtime must load the authenticated user through the API');
  assert.match(runtime, /api\('\/api\/plans'\)/, 'runtime must load plans through the API');
});
