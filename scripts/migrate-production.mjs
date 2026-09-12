import { spawn } from 'node:child_process';

const migration = '20260912090000_file_ai_schema';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['prisma', ...args], { stdio: 'inherit', shell: false, env: process.env });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
}

const first = await run(['migrate', 'deploy']);
if (first === 0) process.exit(0);

// GitHub CI uses a disposable PostgreSQL service. It has no production schema,
// so db push is appropriate there. Production is never allowed to use db push.
if (process.env.CI === 'true' || process.env.PRISMA_MIGRATION_BOOTSTRAP === 'ci') {
  process.exit(await run(['db', 'push', '--skip-generate']));
}

// Existing production databases have pre-Prisma tables and therefore need a
// one-time, non-destructive bootstrap. We execute only the QMRMed-owned File AI
// migration, then record it as applied. No drop/reset/accept-data-loss is used.
const apply = await run(['db', 'execute', '--schema', 'prisma/schema.prisma', '--file', `prisma/migrations/${migration}/migration.sql`]);
if (apply !== 0) process.exit(apply);

const resolve = await run(['migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', migration]);
process.exit(resolve);
