import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const migration = '20260912090000_file_ai_schema';
const migrationFile = `prisma/migrations/${migration}/migration.sql`;
const bootstrapFile = '/tmp/qmrmed-file-ai-bootstrap.sql';
const prisma = new PrismaClient();

function run(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['prisma', ...args], {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      env: process.env,
    });
    let output = '';
    if (capture) {
      child.stdout.on('data', chunk => { const text = String(chunk); output += text; process.stdout.write(text); });
      child.stderr.on('data', chunk => { const text = String(chunk); output += text; process.stderr.write(text); });
    }
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? 1, output }));
  });
}

async function sleep(ms) { await new Promise(resolve => setTimeout(resolve, ms)); }

async function productionMigration() {
  const dirs = (await readdir('prisma/migrations', { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();

  let applied = new Set();
  let historyExists = true;
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    applied = new Set(rows.map(row => row.migration_name));
  } catch (error) {
    if (String(error?.message ?? error).includes('does not exist')) historyExists = false;
    else throw error;
  }

  if (historyExists) {
    const pending = dirs.filter(name => !applied.has(name));
    if (pending.length === 0) {
      console.log('Production migration check: schema is current; no migration lock required.');
      return 0;
    }
    console.log(`Production migration check: ${pending.length} pending migration(s): ${pending.join(', ')}`);
  } else {
    console.log('Production migration history is absent; running the one-time QMRMed baseline bootstrap.');
    const migrationSql = await readFile(migrationFile, 'utf8');
    const safeSql = migrationSql
      .replaceAll('CREATE TABLE "', 'CREATE TABLE IF NOT EXISTS "')
      .replaceAll('CREATE UNIQUE INDEX "', 'CREATE UNIQUE INDEX IF NOT EXISTS "')
      .replaceAll('CREATE INDEX "', 'CREATE INDEX IF NOT EXISTS "');
    await writeFile(bootstrapFile, safeSql, 'utf8');
    try {
      const apply = await run(['db', 'execute', '--schema', 'prisma/schema.prisma', '--file', bootstrapFile]);
      if (apply.code !== 0) return apply.code;
    } finally {
      await rm(bootstrapFile, { force: true });
    }
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const resolved = await run(['migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', migration], { capture: true });
      if (resolved.code === 0) return 0;
      if (!resolved.output.includes('P1002') || attempt === 8) return resolved.code;
      console.warn(`Production migration resolve lock contention; retry ${attempt}/8.`);
      await sleep(3000);
    }
  }

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await run(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { capture: true });
    if (result.code === 0) return 0;
    if (!result.output.includes('P1002') || attempt === 12) return result.code;
    console.warn(`Production migration lock contention; retry ${attempt}/12.`);
    await sleep(3000);
  }
  return 1;
}

try {
  if (process.env.CI === 'true' || process.env.PRISMA_MIGRATION_BOOTSTRAP === 'ci') {
    const result = await run(['db', 'push', '--skip-generate']);
    process.exitCode = result.code;
  } else {
    process.exitCode = await productionMigration();
  }
} finally {
  await prisma.$disconnect();
}
