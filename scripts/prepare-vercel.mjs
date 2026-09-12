import { cp, mkdir, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'miniapp');
const output = join(root, 'public');

const required = ['index.html', 'styles.css', 'runtime.js'];

for (const file of required) {
  await access(join(source, file), constants.R_OK);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Vercel serves the configured output directory as the static site root.
// Keep both / and /miniapp/ working while the /api function remains outside it.
await cp(source, output, { recursive: true });
for (const file of required) {
  await cp(join(source, file), join(output, file));
}

console.log(`Prepared Vercel static output: ${output}`);
console.log('Static routes: / and /miniapp/');
console.log('API route remains: /api/*');
