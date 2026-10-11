import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config';

const databaseUrl = 'postgresql://localhost:5432/olconet';

test('liest die PostgreSQL-Konfiguration und den Standardport', () => {
  assert.deepEqual(readConfig({ DATABASE_URL: databaseUrl }), { databaseUrl, port: 18433 });
});

test('akzeptiert den internen Container-Port', () => {
  assert.equal(readConfig({ DATABASE_URL: databaseUrl, PORT: '8080' }).port, 8080);
});

test('weist fehlende oder ungueltige Datenbankkonfiguration zurueck', () => {
  for (const value of [undefined, '', 'keine-url', 'https://localhost/db', 'postgresql://localhost/']) {
    assert.throws(() => readConfig({ DATABASE_URL: value }));
  }
});

test('weist ungueltige Ports zurueck', () => {
  for (const port of ['', 'abc', '0', '65536', '1.5']) {
    assert.throws(() => readConfig({ DATABASE_URL: databaseUrl, PORT: port }));
  }
});
