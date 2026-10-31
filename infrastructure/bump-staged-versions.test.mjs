import assert from 'node:assert/strict';
import test from 'node:test';
import { bumpPatch, packagesWithChanges, replaceVersion } from './bump-staged-versions.mjs';

test('bumpPatch erhoeht nur die Patch-Stelle', () => {
  assert.equal(bumpPatch('0.1.0'), '0.1.1');
  assert.equal(bumpPatch('1.2.9'), '1.2.10');
});

test('bumpPatch lehnt ungueltige Versionen ab', () => {
  for (const version of ['1.2', '1.2.3-beta', 'v1.2.3', '', undefined]) {
    assert.throws(() => bumpPatch(version), /Ungueltige Version/);
  }
});

test('packagesWithChanges erkennt nur Pakete mit gestagten Dateien', () => {
  const staged = ['apps/backend/src/main.ts', 'apps/homepage/package.json', 'infrastructure/static-server.mjs', 'README.md'];
  const dirs = ['apps/admin', 'apps/backend', 'apps/homepage'];
  assert.deepEqual(packagesWithChanges(staged, dirs), ['apps/backend', 'apps/homepage']);
});

test('packagesWithChanges verlangt Dateien unterhalb des Ordners', () => {
  assert.deepEqual(packagesWithChanges(['apps/backend-tools/x.ts'], ['apps/backend']), []);
});

test('replaceVersion ersetzt nur das Versionsfeld', () => {
  const manifest = '{\n  "name": "@olconet/backend",\n  "version": "0.1.0",\n  "dependencies": { "x": "0.1.0" }\n}\n';
  const updated = replaceVersion(manifest, '0.1.1');
  assert.equal(JSON.parse(updated).version, '0.1.1');
  assert.equal(JSON.parse(updated).dependencies.x, '0.1.0');
});

test('replaceVersion schlaegt ohne Versionsfeld fehl', () => {
  assert.throws(() => replaceVersion('{\n  "name": "x"\n}\n', '0.1.1'), /Version konnte nicht ersetzt werden|JSON/);
});
