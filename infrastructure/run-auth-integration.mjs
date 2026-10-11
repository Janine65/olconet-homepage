import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Docker command failed');
  return result.stdout.trim();
}

const password = randomBytes(24).toString('hex');
const directory = mkdtempSync(join(tmpdir(), 'olconet-auth-integration-'));
const dotenv = join(directory, '.env');
writeFileSync(dotenv, '');
let container;
try {
  container = docker([
    'run', '--rm', '-d', '-p', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql:rw',
    '-e', 'POSTGRES_DB=olconet_test', '-e', 'POSTGRES_USER=olconet',
    '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:18-bookworm',
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'olconet', '-d', 'olconet_test']);
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Isolated PostgreSQL did not become ready');
  const port = docker(['port', container, '5432/tcp']).split(':').at(-1);
  const url = `postgresql://olconet:${password}@127.0.0.1:${port}/olconet_test?schema=webpage`;
  const env = {
    ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url,
    ADMIN_ORIGIN: 'http://localhost:18432', DOTENV_CONFIG_PATH: dotenv,
    SITE_URL: 'http://localhost:18431',
    UPLOAD_DIR: join(directory, 'uploads'),
    NODE_ENV: 'test', OLCONET_ISOLATED_TEST: '1',
  };
  for (const command of ['db:deploy', 'test:integration']) {
    const result = spawnSync('pnpm', ['--filter', '@olconet/backend', command], { env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${command} failed`);
  }
} finally {
  if (container) docker(['stop', container]);
  rmSync(directory, { recursive: true });
}
