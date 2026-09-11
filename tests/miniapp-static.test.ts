import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function text(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

test('Mini App has a visible server-side fallback before JavaScript runs', async () => {
  const html = await text('miniapp/index.html');
  assert.match(html, /<main id="view"[^>]*>\s*<section class="hero">/, 'home content must exist in HTML');
  assert.match(html, /مرحباً بك/, 'fallback must show a welcome state');
  assert.match(html, /data-route="plans"/, 'subscription navigation must exist');
  assert.match(html, /data-route="archive"/, 'archive navigation must exist');
});

test('Mini App loads runtime and keeps the shell independent of API readiness', async () => {
  const html = await text('miniapp/index.html');
  const runtime = await text('miniapp/runtime.js');

  assert.notEqual(html.indexOf('src="/miniapp/runtime.js'), -1, 'runtime.js must be loaded');
  assert.match(runtime, /function render\(\)/, 'runtime must contain the render implementation');
  assert.match(runtime, /routeFromTelegram\(\)/, 'runtime must restore supported deep routes');
  assert.match(runtime, /render\(\);/, 'runtime must initialize the first render');
  assert.match(runtime, /loadUser\(\);/, 'runtime must load user data after the initial render');
  assert.match(runtime, /api\('\/api\/me'\)/, 'runtime must load the authenticated user');
  assert.match(runtime, /api\('\/api\/plans'\)/, 'runtime must load plans');
  assert.match(runtime, /api\('\/api\/archive'\)/, 'runtime must load the archive');
  assert.match(runtime, /loadArchiveDetail/, 'runtime must open an archive result');
});
