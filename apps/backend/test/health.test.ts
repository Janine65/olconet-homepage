import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

test('liveness bleibt verfuegbar, readiness meldet fehlende Datenbank mit HTTP 503', async (t) => {
  const previous = process.env['DATABASE_URL'];
  process.env['DATABASE_URL'] = 'postgresql://localhost:1/olconet';
  const app = await NestFactory.create(AppModule, { logger: false });
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = previous;
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const live = await fetch(`${base}/health/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok' });
  const ready = await fetch(`${base}/health/ready`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), {
    message: 'Datenbank nicht erreichbar.',
    error: 'Service Unavailable',
    statusCode: 503,
  });
  const protectedRequest = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: `olconet_session=${'a'.repeat(43)}` },
  });
  assert.equal(protectedRequest.status, 503);
  assert.deepEqual(await protectedRequest.json(), {
    statusCode: 503,
    message: 'Der Dienst ist voruebergehend nicht verfuegbar.',
  });
});
