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
import { VisitorAnalyticsService } from '../src/visitor-analytics.service';

test('Persistente Besuche pro Browser-Sitzung und lokaler Testmodus', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const secret = 'test-only-visitor-secret-at-least-32-characters';
  const settings = {
    NODE_ENV: 'production', VISITOR_PROXY_SECRET: secret,
    VISITOR_TRUSTED_PROXIES: '192.168.1.200', VISITOR_EXCLUDED_IPS: '203.0.113.10',
    PUBLIC_VISITOR_TRACKING_TEST_MODE: '',
    SITE_URL: 'http://localhost:18441',
    GEOIP_COUNTRY_DB: '',
    TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
    SMTP_HOST: '', SMTP_PORT: '587', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: '',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  let app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app); await app.listen(0, '127.0.0.1');
  let db = app.get(PrismaService);
  const base = `${await app.getUrl()}/api/public/visitors`;
  t.after(async () => {
    await db.visitorPageView.deleteMany();
    await db.visitorSession.deleteMany();
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const headers = (kind: 'external' | 'excluded', time = Date.now()) => {
    const proof = `${time}:${kind}`;
    const ip = kind === 'external' ? '198.51.100.20' : '';
    return {
      Origin: process.env['SITE_URL']!, 'Content-Type': 'application/json', 'X-Olconet-Request': '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'X-Olconet-Visitor-Proof': proof,
      ...(ip ? { 'X-Olconet-Visitor-Ip': ip } : {}),
      'X-Olconet-Visitor-Signature': createHmac('sha256', secret).update(`${proof}\n${ip}`).digest('hex'),
    };
  };
  const post = (extra: Record<string, string>, body: object = { path: '/kontakt/', referrer: '' }) =>
    fetch(base, { method: 'POST', headers: extra, body: JSON.stringify(body) });
  assert.equal((await fetch(base)).status, 404);
  const contactConfig = await fetch(`${await app.getUrl()}/api/public/contact/config`);
  assert.deepEqual(await contactConfig.json(), { enabled: false });
  const contactHeaders = {
    Origin: process.env['SITE_URL']!, 'Content-Type': 'application/json', 'X-Olconet-Request': '1',
  };
  assert.equal((await fetch(`${await app.getUrl()}/api/public/contact`, {
    method: 'POST', headers: { ...contactHeaders, Origin: 'https://foreign.example' }, body: '{}',
  })).status, 403);
  assert.equal((await fetch(`${await app.getUrl()}/api/public/contact`, {
    method: 'POST', headers: contactHeaders, body: '{}',
  })).status, 503);
  assert.equal((await post({ ...headers('external'), Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post({ ...headers('external'), 'X-Olconet-Visitor-Signature': '0'.repeat(64) })).status, 503);
  assert.equal((await post({ ...headers('external'), 'X-Olconet-Visitor-Ip': '198.51.100.21' })).status, 503);
  assert.equal((await post(headers('external', Date.now() - 60000))).status, 503);
  assert.equal(visitorProof({}, secret), null);
  const excluded = await post(headers('excluded'));
  assert.deepEqual(await excluded.json(), { enabled: true, excluded: true });
  assert.match(excluded.headers.get('set-cookie')!, /olconet_visit=; .*Expires=/);
  const first = await post(headers('external'), { path: '/kontakt/', referrer: 'https://www.google.com/search?q=trip' });
  assert.equal(first.status, 201);
  const firstResult = await first.json() as { enabled: boolean; pageViewId: string };
  assert.equal(firstResult.enabled, true);
  assert.match(firstResult.pageViewId, /^[a-f0-9-]{36}$/i);
  const setCookies = first.headers.getSetCookie();
  const cookie = setCookies.find(value => value.startsWith('olconet_analytics='))!;
  assert.match(cookie, /olconet_analytics=/);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Expires=|Max-Age=/);
  assert.ok(setCookies.some(value => /olconet_visit=; .*Expires=/.test(value)));
  const repeated = await Promise.all(Array.from({ length: 3 }, () =>
    post({ ...headers('external'), Cookie: cookie.split(';')[0] })));
  for (const response of repeated) assert.equal(response.status, 201);
  const exit = await post({ ...headers('external'), Cookie: cookie.split(';')[0] },
    { finish: true, pageViewId: firstResult.pageViewId, durationSeconds: 42 });
  assert.deepEqual(await exit.json(), { enabled: true });
  assert.equal(await db.visitorSession.count(), 1);
  assert.equal(await db.visitorPageView.count(), 4);
  const session = await db.visitorSession.findFirst({ include: { pageViews: true } });
  assert.equal(session?.country, null);
  assert.equal(session?.source, 'search');
  assert.equal(session?.device, 'desktop');
  assert.equal(session?.browser, 'Chrome');
  assert.equal(session?.pageViews.filter(view => view.durationSeconds === 42).length, 1);
  const today = new Date().toISOString().slice(0, 10);
  const report = await app.get(VisitorAnalyticsService).report(today, today);
  assert.equal(report.totalSessions, 1);
  assert.equal(report.totalPageViews, 4);
  assert.equal(report.averageDurationSeconds, 42);
  assert.deepEqual(report.sessionsBySource, [{ label: 'search', count: 1 }]);
  assert.deepEqual(report.pageViewsByPage, [{ label: '/kontakt/', count: 4 }]);
  assert.equal(visitorProof({
    'x-olconet-visitor-proof': `${Date.now()}:external`,
    'x-olconet-visitor-ip': 'invalid',
    'x-olconet-visitor-signature': '0'.repeat(64),
  }, secret), null);
  await app.close();
  process.env['NODE_ENV'] = 'development';
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  db = app.get(PrismaService);
  configureHttp(app); await app.listen(0, '127.0.0.1');
  const restartedUrl = `${await app.getUrl()}/api/public/visitors`;
  const local = await fetch(restartedUrl, {
    method: 'POST', headers: headers('external'), body: JSON.stringify({ path: '/', referrer: '' }),
  });
  assert.deepEqual(await local.json(), { enabled: false });
  assert.match(local.headers.get('set-cookie')!, /olconet_visit=; .*Expires=/);
  delete process.env['NODE_ENV'];
  process.env['PUBLIC_VISITOR_TRACKING_TEST_MODE'] = 'true';
  const testVisit = await fetch(restartedUrl, {
    method: 'POST',
    headers: {
      Origin: process.env['SITE_URL']!, 'Content-Type': 'application/json', 'X-Olconet-Request': '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    },
    body: JSON.stringify({ path: '/test/', referrer: '' }),
  });
  assert.equal(testVisit.status, 201);
  const testVisitResult = await testVisit.json() as { enabled: boolean; pageViewId: string };
  assert.equal(testVisitResult.enabled, true);
  assert.match(testVisitResult.pageViewId, /^[a-f0-9-]{36}$/i);
  assert.equal(await db.visitorSession.count(), 2);
  assert.equal((await db.visitorSession.findFirst({ where: { country: null, pageViews: { some: { path: '/test/' } } } }))?.country, null);
});
