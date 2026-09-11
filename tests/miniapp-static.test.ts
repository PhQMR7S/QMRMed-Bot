import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function text(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

test('Mini App has a visible loading shell before JavaScript runs', async () => {
  const html = await text('miniapp/index.html');
  assert.match(html, /<main id="view"[^>]*>\s*<div class="loading">/, 'loading shell must exist in HTML');
  assert.doesNotMatch(html, /QMR7S|Telegram user|plan-pill/, 'HTML shell must not contain fake account data');
  assert.match(html, /data-route="plans"/, 'subscription navigation must exist');
  assert.match(html, /data-route="archive"/, 'archive navigation must exist');
});

test('Mini App uses accessible vector icons instead of Unicode glyph placeholders', async () => {
  const html = await text('miniapp/index.html');
  assert.match(html, /data-route="home"[\s\S]*?<svg[^>]*>[\s\S]*?<path/, 'home must use an SVG icon');
  assert.match(html, /data-route="plans"[\s\S]*?<svg[^>]*>[\s\S]*?<path/, 'subscription must use an SVG icon');
  assert.match(html, /data-route="archive"[\s\S]*?<svg[^>]*>[\s\S]*?<path/, 'archive must use an SVG icon');
  assert.match(html, /data-route="account"[\s\S]*?<svg[^>]*>[\s\S]*?<circle/, 'account must use an SVG icon');
  assert.match(html, /data-route="menu"[\s\S]*?<svg[^>]*>[\s\S]*?<path/, 'more must use an SVG icon');
  assert.doesNotMatch(html, /[♛⌂▣●☰]/, 'navigation must not use Unicode icon placeholders');
  assert.match(html, /aria-hidden="true"/, 'decorative icons must be hidden from screen readers');
});

test('Mini App loads runtime and keeps the shell independent of API readiness', async () => {
  const html = await text('miniapp/index.html');
  const runtime = await text('miniapp/runtime.js');

  assert.notEqual(html.indexOf('src="/miniapp/runtime.js'), -1, 'runtime.js must be loaded');
  assert.match(runtime, /function render\(\)/, 'runtime must contain the render implementation');
  assert.match(runtime, /routeFromTelegram\(\)/, 'runtime must restore supported deep routes');
  assert.match(runtime, /routeFromTelegram\(\);\s*if \(tg\)/, 'runtime must actually apply the deep route before rendering');
  assert.match(runtime, /render\(\);/, 'runtime must initialize the first render');
  assert.match(runtime, /loadUser\(\);/, 'runtime must load user data after the initial render');
  assert.match(runtime, /api\('\/api\/me'\)/, 'runtime must load the authenticated user');
  assert.match(runtime, /api\('\/api\/plans'\)/, 'runtime must load plans');
  assert.match(runtime, /api\('\/api\/archive'\)/, 'runtime must load the archive');
  assert.match(runtime, /loadArchiveDetail/, 'runtime must open an archive result');
  assert.match(runtime, /data-retry/, 'runtime must expose retry states');
  assert.match(runtime, /photoUrl/, 'runtime must render the backend profile photo');
});

test('Docker build uses the project Node runtime family', async () => {
  const dockerfile = await text('Dockerfile');
  assert.match(dockerfile, /^FROM node:24-/m, 'Dockerfile must use the project Node 24 runtime family');
  assert.match(dockerfile, /npm ci/, 'Dockerfile must install from the lockfile');
  assert.match(dockerfile, /npm run build/, 'Dockerfile must build TypeScript before startup');
  assert.match(dockerfile, /EXPOSE 8080/, 'Dockerfile must document the HTTP port');
  assert.match(dockerfile, /start:miniapp/, 'Dockerfile must start the standalone Mini App');
});
