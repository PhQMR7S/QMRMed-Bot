import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function text(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

test('Mini App loads app.js before bootstrap and bootstrap initializes the view', async () => {
  const html = await text('miniapp/index.html');
  const bootstrap = await text('miniapp/bootstrap.js');
  const app = await text('miniapp/app.js');

  const appScript = html.indexOf('src="/miniapp/app.js"');
  const bootstrapScript = html.indexOf('src="/miniapp/bootstrap.js"');

  assert.notEqual(appScript, -1, 'app.js must be loaded by the Mini App');
  assert.notEqual(bootstrapScript, -1, 'bootstrap.js must be loaded by the Mini App');
  assert.ok(appScript < bootstrapScript, 'bootstrap.js must run after app.js');
  assert.match(app, /async function render\(\)/, 'app.js must expose the render implementation');
  assert.match(bootstrap, /typeof window\.render === 'function'/, 'bootstrap must initialize the first render');
  assert.match(bootstrap, /window\.render\(\)/, 'bootstrap must invoke the initial render');
});
