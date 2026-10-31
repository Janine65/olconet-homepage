import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { visitorProof } from '../src/visitors.controller';

test('Persistente Besuche pro Browser-Sitzung ohne lokale Zugriffe', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const secret = 'test-only-visitor-secret-at-least-32-characters';
  const settings = {
    NODE_ENV: 'production', VISITOR_PROXY_SECRET: secret,
    VISITOR_TRUSTED_PROXIES: '192.168.1.200', VISITOR_EXCLUDED_IPS: '203.0.113.10',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  let app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app); await app.listen(0, '127.0.0.1');
  let db = app.get(PrismaService);
  const base = `${await app.getUrl()}/api/public/visitors`;
  t.after(async () => {
    await db.visitorSession.deleteMany();
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const headers = (kind: 'external' | 'excluded', time = Date.now()) => {
    const proof = `${time}:${kind}`;
    return {
      Origin: process.env['SITE_URL']!, 'Content-Type': 'application/json', 'X-Olconet-Request': '1',
      'X-Olconet-Visitor-Proof': proof,
      'X-Olconet-Visitor-Signature': createHmac('sha256', secret).update(proof).digest('hex'),
    };
  };
  const post = (extra: Record<string, string>) => fetch(base, { method: 'POST', headers: extra, body: '{}' });
  assert.deepEqual(await (await fetch(base)).json(), { total: 0, enabled: true });
  assert.equal((await post({ ...headers('external'), Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post({ ...headers('external'), 'X-Olconet-Visitor-Signature': '0'.repeat(64) })).status, 503);
  assert.equal((await post(headers('external', Date.now() - 60000))).status, 503);
  assert.equal(visitorProof({}, secret), null);
  const excluded = await post(headers('excluded'));
  assert.deepEqual(await excluded.json(), { total: 0, enabled: true });
  assert.equal(excluded.headers.get('set-cookie'), null);
  const first = await post(headers('external'));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { total: 1, enabled: true });
  const cookie = first.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Expires=|Max-Age=/);
  const repeated = await Promise.all(Array.from({ length: 3 }, () =>
    post({ ...headers('external'), Cookie: cookie.split(';')[0] })));
  for (const response of repeated) assert.equal((await response.json()).total, 1);
  assert.equal((await (await post(headers('external'))).json()).total, 2);
  assert.equal((await (await post(headers('excluded'))).json()).total, 2);
  assert.equal(await db.visitorSession.count(), 2);
  const rows = await db.visitorSession.findMany();
  assert.deepEqual(Object.keys(rows[0]).sort(), ['createdAt', 'id']);
  await app.close();
  process.env['NODE_ENV'] = 'development';
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  db = app.get(PrismaService);
  configureHttp(app); await app.listen(0, '127.0.0.1');
  const restartedUrl = `${await app.getUrl()}/api/public/visitors`;
  assert.deepEqual(await (await fetch(restartedUrl)).json(), { total: 2, enabled: false });
  const local = await fetch(restartedUrl, { method: 'POST', headers: headers('external'), body: '{}' });
  assert.deepEqual(await local.json(), { total: 2, enabled: false });
  assert.equal(local.headers.get('set-cookie'), null);
});
