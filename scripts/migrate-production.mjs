import { spawn } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';

const migration = '20260912090000_file_ai_schema';
const migrationFile = `prisma/migrations/${migration}/migration.sql`;
const bootstrapFile = '/tmp/qmrmed-file-ai-bootstrap.sql';

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

// Existing production databases contain legacy QMRMed/hosting tables and do not
// have Prisma migration history. Bootstrap only the QMRMed File AI objects.
// The SQL is made idempotent for this one-time bootstrap so a partially-created
// table from an earlier interrupted attempt cannot make the deployment fail.
const migrationSql = await readFile(migrationFile, 'utf8');
const safeSql = migrationSql
  .replaceAll('CREATE TABLE "', 'CREATE TABLE IF NOT EXISTS "')
  .replaceAll('CREATE UNIQUE INDEX "', 'CREATE UNIQUE INDEX IF NOT EXISTS "')
  .replaceAll('CREATE INDEX "', 'CREATE INDEX IF NOT EXISTS "');
await writeFile(bootstrapFile, safeSql, 'utf8');

try {
  const apply = await run(['db', 'execute', '--schema', 'prisma/schema.prisma', '--file', bootstrapFile]);
  if (apply !== 0) process.exit(apply);
} finally {
  await rm(bootstrapFile, { force: true });
}

const resolve = await run(['migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', migration]);
process.exit(resolve);
