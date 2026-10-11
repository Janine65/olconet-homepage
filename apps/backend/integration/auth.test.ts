import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';

test('Verwaltungslogin mit echter isolierter PostgreSQL-Datenbank', async (t) => {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  assert.ok(databaseUrl && process.env['OLCONET_ISOLATED_TEST'] === '1',
    'Nur ueber pnpm test:integration im Projektwurzelverzeichnis ausfuehren.');
  assert.equal(new URL(databaseUrl).pathname, '/olconet_test');
  assert.equal(new URL(databaseUrl).searchParams.get('schema'), 'webpage');
  process.env['DATABASE_URL'] = databaseUrl;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app);
  const prisma = app.get(PrismaService);
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); });
  let base = await app.getUrl();
  const origin = 'http://localhost:18432';
  const password = 'Only-for-isolated-tests!';
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const login = (email: string, pass = password, extra: Record<string, string> = {}) =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ email, password: pass }),
    });

  await t.test('Konten werden per CLI normalisiert angelegt, Duplikate abgewiesen', () => {
    const args = ['node_modules/tsx/dist/cli.mjs', 'src/cli/create-admin.ts',
      '--email', ' First@Example.com ', '--name', 'First Admin', '--password-stdin'];
    const created = spawnSync(process.execPath, args, { input: `${password}\n`, encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /first@example.com/);
    const duplicate = spawnSync(process.execPath, args, { input: `${password}\n`, encoding: 'utf8' });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /existiert bereits/);
    const weak = spawnSync(process.execPath, [...args.slice(0, 2),
      '--email', 'weak@example.com', '--name', 'Weak', '--password-stdin'], { input: 'short\n', encoding: 'utf8' });
    assert.equal(weak.status, 1);
    assert.match(weak.stderr, /mindestens 12/);
  });
  const first = await prisma.adminUser.findUniqueOrThrow({ where: { email: 'first@example.com' } });
  await prisma.adminUser.create({
    data: { email: 'second@example.com', displayName: 'Second Admin', passwordHash: await hashPassword(password) },
  });

  await t.test('DB-Schema entspricht nach Migrationen exakt dem Modell', () => {
    const result = spawnSync(process.execPath, [
      'node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-config-datasource',
      '--to-schema', 'prisma/schema.prisma', '--exit-code',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });

  await t.test('Ohne Sitzung sind private Endpunkte gesperrt; Health bleibt oeffentlich', async () => {
    for (const path of ['/api/auth/me', '/api/admin/overview']) {
      assert.equal((await fetch(`${base}${path}`)).status, 401);
    }
    for (const path of ['/health/live', '/health/ready']) {
      assert.equal((await fetch(`${base}${path}`)).status, 200);
    }
    assert.equal((await fetch(`${base}/api/auth/register`, { method: 'POST', headers, body: '{}' })).status, 404);
  });

  await t.test('CSRF-Schutz, Input-Validierung und Anfragegroessen werden durchgesetzt', async () => {
    assert.equal((await login(first.email, password, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await login(first.email, password, { 'X-Olconet-Request': '' })).status, 403);
    const noOrigin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
      body: JSON.stringify({ email: first.email, password }),
    });
    assert.equal(noOrigin.status, 403);
    assert.equal((await login(first.email, password, { 'Content-Type': 'text/plain' })).status, 403);
    assert.equal((await login('invalid')).status, 400);
    assert.equal((await login(first.email, 'x'.repeat(129))).status, 400);
    const malformed = await fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: '{' });
    assert.equal(malformed.status, 400);
    const huge = await fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ value: 'x'.repeat(140000) }) });
    assert.equal(huge.status, 413);
  });

  await t.test('Unbekannte Konten und falsche Passwoerter liefern dieselbe Fehlermeldung', async () => {
    const wrong = await login(first.email, 'wrong');
    const missing = await login('missing@example.com');
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.deepEqual(await wrong.json(), await missing.json());
    assert.equal(wrong.headers.get('set-cookie'), null);
  });

  let cookie = '';
  let token = '';
  await t.test('Login setzt HttpOnly-Cookie und speichert nur einen Token-Hash', async () => {
    const response = await login(' FIRST@Example.com ');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(Object.keys(result.user).sort(), ['displayName', 'email', 'id']);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    token = cookie.split('=')[1];
    assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(response.headers.get('set-cookie')!, /SameSite=Strict/);
    assert.match(response.headers.get('set-cookie')!, /Path=\/api/);
    assert.match(response.headers.get('set-cookie')!, /Max-Age=28800/);
    assert.doesNotMatch(response.headers.get('set-cookie')!, /; Secure/);
    const stored = await prisma.adminSession.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } });
    assert.notEqual(stored.tokenHash, token);
    assert.ok(stored.expiresAt.getTime() > Date.now() + 28700 * 1000);
  });

  await t.test('Geschuetzte Uebersicht und Sitzungswiederherstellung funktionieren', async () => {
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, first.email);
    const overview = await fetch(`${base}/api/admin/overview`, { headers: { Cookie: cookie } });
    assert.equal(overview.status, 200);
    assert.deepEqual(await overview.json(), { reports: 0, drawings: 0, sammyPhotos: 0 });
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: 'olconet_session=forged' } })).status, 401);
  });

  await t.test('Sitzungen ueberleben Backend-Neustarts', async () => {
    const restarted = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
    configureHttp(restarted);
    await restarted.listen(0, '127.0.0.1');
    try {
      assert.equal((await fetch(`${await restarted.getUrl()}/api/auth/me`, { headers: { Cookie: cookie } })).status, 200);
    } finally { await restarted.close(); }
  });

  await t.test('Neuer Login rotiert die alte Sitzung', async () => {
    const response = await login(first.email, password, { Cookie: cookie });
    assert.equal(response.status, 200);
    const previous = cookie;
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    assert.notEqual(cookie, previous);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: previous } })).status, 401);
  });

  await t.test('Mehrere Konten besitzen getrennte Sitzungen; Logout widerruft serverseitig', async () => {
    const second = await login('second@example.com');
    assert.equal(second.status, 200);
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { ...headers, Cookie: cookie, Origin: 'https://foreign.example' }, body: '{}',
    })).status, 403);
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: secondCookie } });
    assert.equal((await me.json()).user.email, 'second@example.com');
    const secondToken = secondCookie.split('=')[1];
    await prisma.adminSession.update({ where: { tokenHash: tokenHash(secondToken) }, data: { expiresAt: new Date(0) } });
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: secondCookie } })).status, 401);
    const repeated = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers, body: '{}' });
    assert.equal(repeated.status, 204);
  });

  await t.test('HTTPS-Origin erzwingt Secure-Cookies', async () => {
    process.env['ADMIN_ORIGIN'] = 'https://admin.example.com';
    const secureApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
    configureHttp(secureApp);
    await secureApp.listen(0, '127.0.0.1');
    try {
      const response = await fetch(`${await secureApp.getUrl()}/api/auth/login`, {
        method: 'POST', headers: { ...headers, Origin: 'https://admin.example.com' },
        body: JSON.stringify({ email: 'second@example.com', password }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie')!, /; Secure/);
    } finally {
      await secureApp.close();
      process.env['ADMIN_ORIGIN'] = origin;
    }
  });

  await t.test('Persistente Limits sperren nach zehn Versuchen, auch bei unbekannten Konten', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login('limit@example.com', 'wrong')).status, 401);
    assert.equal((await login('limit@example.com', 'wrong')).status, 429);
    assert.equal((await prisma.loginThrottle.findUniqueOrThrow({
      where: { key: `email:${tokenHash('limit@example.com')}` },
    })).attempts, 11);
    const restarted = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
    configureHttp(restarted);
    await restarted.listen(0, '127.0.0.1');
    try {
      const blocked = await fetch(`${await restarted.getUrl()}/api/auth/login`, {
        method: 'POST', headers, body: JSON.stringify({ email: 'limit@example.com', password: 'wrong' }),
      });
      assert.equal(blocked.status, 429);
    } finally { await restarted.close(); }
    await prisma.loginThrottle.update({ where: { key: `email:${tokenHash('limit@example.com')}` },
      data: { expiresAt: new Date(0) } });
    assert.equal((await login('limit@example.com', 'wrong')).status, 401);
    const simultaneous = await Promise.all(Array.from({ length: 12 }, () => login('concurrent@example.com', 'wrong')));
    assert.equal(simultaneous.filter((response) => response.status === 401).length, 10);
    assert.equal(simultaneous.filter((response) => response.status === 429).length, 2);
    await prisma.loginThrottle.update({ where: { key: 'global' }, data: { attempts: 100 } });
    assert.equal((await login('new@example.com')).status, 429);
  });
});
