import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('SQL-Migrationen entsprechen Prisma-Diffs fuer Grundmodell und Editor-Erweiterung', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'olconet-schema-test-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const baseline = join(directory, 'baseline.prisma');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const mediaSchema = join(directory, 'media.prisma');
  writeFileSync(mediaSchema, schema.replace(/^.*(?:uploadKey|uploadFingerprint|inGallery|caption\s+String\?).*\n/gm, ''));
  const editorSchema = join(directory, 'editor.prisma');
  writeFileSync(editorSchema, readFileSync(mediaSchema, 'utf8').replace(/^.*revision.*\n/m, ''));
  writeFileSync(baseline, readFileSync(editorSchema, 'utf8')
    .replace(/^.*contentHtml.*\n/m, '').replace(/^.*version.*\n/m, '')
    .replace(/(contentMarkdown\s+String)\s+@default\(""\)/, '$1'));
  const diff = (from: string[], to: string) => {
    const result = spawnSync(process.execPath, [
      'node_modules/prisma/build/index.js', 'migrate', 'diff',
      ...from, '--to-schema', to, '--script',
    ], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://localhost:1/olconet' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const statements = (sql: string) => sql.replace(/^--.*$/gm, '').split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();
  const baseMigrations = readdirSync('prisma/migrations', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ['20261011090000_initial', '20261011100000_admin_sessions'].includes(entry.name))
    .map((entry) => readFileSync(`prisma/migrations/${entry.name}/migration.sql`, 'utf8')).join('\n');
  assert.deepEqual(statements(diff(['--from-empty'], baseline)), statements(baseMigrations));
  assert.deepEqual(statements(diff(['--from-schema', baseline], editorSchema)),
    statements(readFileSync('prisma/migrations/20261011110000_travel_editor/migration.sql', 'utf8')));
  assert.deepEqual(statements(diff(['--from-schema', editorSchema], mediaSchema)),
    statements(readFileSync('prisma/migrations/20261011120000_media_upload/migration.sql', 'utf8')));
  assert.deepEqual(statements(diff(['--from-schema', mediaSchema], 'prisma/schema.prisma')),
    statements(readFileSync('prisma/migrations/20261011130000_report_images/migration.sql', 'utf8')));
});

test('Migrationsbefehle ohne DATABASE_URL scheitern explizit', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'olconet-config-test-'));
  const dotenvPath = join(directory, '.env');
  writeFileSync(dotenvPath, '');
  t.after(() => rmSync(directory, { recursive: true }));
  const env = { ...process.env, DOTENV_CONFIG_PATH: dotenvPath };
  delete env['DATABASE_URL'];
  const result = spawnSync(process.execPath, [
    'node_modules/prisma/build/index.js', 'migrate', 'deploy',
  ], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL muss/);
});
