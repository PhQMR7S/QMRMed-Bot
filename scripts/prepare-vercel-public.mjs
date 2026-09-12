import { cp, mkdir, rm } from 'node:fs/promises';

await rm('public', { recursive: true, force: true });
await mkdir('public', { recursive: true });
await cp('miniapp', 'public', { recursive: true });

console.log('Prepared Vercel public output from miniapp/.');
