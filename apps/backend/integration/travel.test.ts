import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';

interface Report { id: string; slug: string; version: number; status: string; publishedAt: string | null; contentHtml: string; authorId: string; }

test('Reisebericht-Lebenszyklus in isoliertem PostgreSQL', async (t) => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  assert.ok(databaseUrl);
  assert.equal(new URL(databaseUrl).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = databaseUrl;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app);
  const prisma = app.get(PrismaService);
  await prisma.loginThrottle.deleteMany();
  const admin = await prisma.adminUser.create({
    data: { email: 'travel@example.com', displayName: 'Travel Admin', passwordHash: await hashPassword('Travel-test-password!') },
  });
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); });
  const base = await app.getUrl();
  const headers = { Origin: 'http://localhost:18432', 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const loggedIn = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers, body: JSON.stringify({ email: admin.email, password: 'Travel-test-password!' }),
  });
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie')!.split(';')[0];
  const post = (path: string, body: object, auth = true) => fetch(`${base}${path}`, {
    method: 'POST', headers: { ...headers, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  const get = (path: string, auth = false) => fetch(`${base}${path}`, { headers: auth ? { Cookie: cookie } : {} });
  const input = {
    title: 'Schweiz & <Berge>', slug: 'schweiz-berge', excerpt: '',
    contentHtml: '', destination: 'Schweiz', travelStart: '2026-07-01', travelEnd: '2026-07-10',
  };
  let report: Report;
  await t.test('Alle Verwaltungsendpunkte verlangen eine Sitzung und CSRF-Schutz', async () => {
    assert.equal((await get('/api/admin/reports')).status, 401);
    assert.equal((await post('/api/admin/reports', input, false)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/reports`, {
      method: 'POST', headers: { ...headers, Origin: 'https://foreign.example', Cookie: cookie }, body: JSON.stringify(input),
    })).status, 403);
    assert.equal((await get('/api/admin/reports?page=0', true)).status, 400);
  });
  await t.test('Neuer Entwurf ist privat und wird dem eingeloggten Konto zugeordnet', async () => {
    const created = await post('/api/admin/reports', input);
    assert.equal(created.status, 201);
    report = await created.json();
    assert.equal(report.status, 'DRAFT');
    assert.equal(report.authorId, admin.id);
    assert.equal(report.version, 0);
    assert.equal((await get(`/api/public/reports/${report.slug}`)).status, 404);
    assert.equal((await (await get('/api/public/reports')).json()).total, 0);
    assert.doesNotMatch(await (await get('/api/public/reports/rss')).text(), /<item>/);
    const list = await (await get('/api/admin/reports', true)).json();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].id, report.id);
    assert.equal('contentHtml' in list.items[0], false);
  });
  await t.test('Leerer Entwurf laesst sich nicht veroeffentlichen; ungueltige Eingaben und Slug-Konflikte werden gemeldet', async () => {
    assert.equal((await post(`/api/admin/reports/${report.id}/publish`, { version: 0 })).status, 400);
    assert.equal((await post('/api/admin/reports', input)).status, 409);
    assert.equal((await post('/api/admin/reports', { ...input, authorId: 'spoof' })).status, 400);
    assert.equal((await post('/api/admin/reports', { ...input, travelEnd: '2026-06-30' })).status, 400);
    assert.equal((await get('/api/admin/reports/not-a-uuid', true)).status, 400);
  });
  const complete = { ...input, excerpt: 'Seen & Berge', contentHtml: '<h2>Unterwegs</h2><p onclick="bad">Hallo <strong>Schweiz</strong><script>bad()</script><img src=x onerror=bad></p>' };
  await t.test('Speichern bereinigt HTML serverseitig und erhoeht die Version', async () => {
    const saved = await post(`/api/admin/reports/${report.id}/save`, { ...complete, version: report.version });
    assert.equal(saved.status, 201);
    report = await saved.json();
    assert.equal(report.version, 1);
    assert.equal(report.contentHtml, '<h2>Unterwegs</h2><p>Hallo <strong>Schweiz</strong></p>');
    assert.equal((await get(`/api/admin/reports/${report.id}`, true)).status, 200);
    assert.equal((await get(`/api/public/reports/${report.slug}`)).status, 404);
  });
  await t.test('Laengere Editor-Texte ueber dem frueheren 8-KB-Limit sind speicherbar', async () => {
    const contentHtml = `<p>${'x'.repeat(20000)}</p>`;
    const saved = await post(`/api/admin/reports/${report.id}/save`, { ...complete, contentHtml, version: report.version });
    assert.equal(saved.status, 201);
    report = await saved.json();
    assert.equal(report.contentHtml, contentHtml);
    const restored = await post(`/api/admin/reports/${report.id}/save`, { ...complete, version: report.version });
    assert.equal(restored.status, 201);
    report = await restored.json();
  });
  await t.test('Veraltete Versionen ueberschreiben keine Aenderungen', async () => {
    assert.equal((await post(`/api/admin/reports/${report.id}/save`, { ...complete, title: 'Falsch', version: 0 })).status, 409);
    assert.equal((await post(`/api/admin/reports/${report.id}/publish`, { version: 0 })).status, 409);
    assert.equal((await get(`/api/admin/reports/${report.id}`, true)).status, 200);
  });
  await t.test('Veroeffentlichung erscheint in Public-API und RSS ohne private Felder', async () => {
    const published = await post(`/api/admin/reports/${report.id}/publish`, { version: report.version });
    assert.equal(published.status, 201);
    report = await published.json();
    assert.equal(report.status, 'PUBLISHED');
    assert.ok(report.publishedAt);
    const publicReport = await (await get(`/api/public/reports/${report.slug}`)).json();
    assert.equal(publicReport.authorId, undefined);
    assert.equal(publicReport.contentMarkdown, undefined);
    assert.equal(publicReport.contentHtml, report.contentHtml);
    const list = await (await get('/api/public/reports')).json();
    assert.equal(list.total, 1);
    const feed = await get('/api/public/reports/rss');
    assert.match(feed.headers.get('content-type')!, /application\/rss\+xml/);
    const xml = await feed.text();
    assert.match(xml, /Schweiz &amp; &lt;Berge&gt;/);
    assert.match(xml, /Seen &amp; Berge/);
    assert.ok(xml.includes(`urn:olconet:travel:${report.id}`));
    assert.match(xml, /http:\/\/localhost:18431\/reisen\/bericht\/\?slug=schweiz-berge/);
  });
  await t.test('Veroeffentlichte Berichte brauchen weiter Inhalt und lassen sich nicht direkt loeschen', async () => {
    assert.equal((await post(`/api/admin/reports/${report.id}/save`, { ...input, version: report.version })).status, 400);
    assert.equal((await post(`/api/admin/reports/${report.id}/delete`, { version: report.version })).status, 400);
    const publishedAt = report.publishedAt;
    const saved = await post(`/api/admin/reports/${report.id}/save`, {
      ...complete, contentHtml: '<p>Aktualisiert</p>', version: report.version,
    });
    assert.equal(saved.status, 201);
    report = await saved.json();
    assert.equal(report.publishedAt, publishedAt);
    assert.equal((await (await get(`/api/public/reports/${report.slug}`)).json()).contentHtml, '<p>Aktualisiert</p>');
  });
  await t.test('Gleichzeitige Aenderungen: genau eine Speicherung gewinnt', async () => {
    const responses = await Promise.all([
      post(`/api/admin/reports/${report.id}/save`, { ...complete, title: 'A', version: report.version }),
      post(`/api/admin/reports/${report.id}/save`, { ...complete, title: 'B', version: report.version }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    report = await (await get(`/api/admin/reports/${report.id}`, true)).json();
  });
  await t.test('Ruecknahme entfernt den Bericht aus Homepage-API und RSS', async () => {
    const removed = await post(`/api/admin/reports/${report.id}/unpublish`, { version: report.version });
    assert.equal(removed.status, 201);
    report = await removed.json();
    assert.equal(report.status, 'DRAFT');
    assert.equal(report.publishedAt, null);
    assert.equal((await get(`/api/public/reports/${report.slug}`)).status, 404);
    assert.equal((await (await get('/api/public/reports')).json()).total, 0);
    assert.doesNotMatch(await (await get('/api/public/reports/rss')).text(), /<item>/);
  });
  await t.test('Loeschen erfordert die aktuelle Entwurfsversion', async () => {
    assert.equal((await post(`/api/admin/reports/${report.id}/delete`, { version: 0 })).status, 409);
    assert.equal((await post(`/api/admin/reports/${report.id}/delete`, { version: report.version })).status, 201);
    assert.equal((await get(`/api/admin/reports/${report.id}`, true)).status, 404);
  });
  await t.test('Seitengroesse ist 20 und oeffentliche Listen enthalten nur Veroeffentlichungen', async () => {
    await prisma.travelReport.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        authorId: admin.id, title: `Bericht ${i}`, slug: `bericht-${i}`, excerpt: 'Test',
        contentHtml: '<p>Test</p>', status: i < 21 ? 'PUBLISHED' : 'DRAFT',
        publishedAt: i < 21 ? new Date(Date.UTC(2026, 0, i + 1)) : null,
      })),
    });
    const first = await (await get('/api/public/reports')).json();
    const second = await (await get('/api/public/reports?page=2')).json();
    assert.equal(first.items.length, 20);
    assert.equal(first.items[0].slug, 'bericht-20');
    assert.equal(first.total, 21);
    assert.equal(second.items.length, 1);
    assert.equal((await (await get('/api/admin/reports?page=2', true)).json()).items.length, 2);
    assert.equal((await get('/api/public/reports/bericht-21')).status, 404);
    const xml = await (await get('/api/public/reports/rss')).text();
    assert.equal((xml.match(/<item>/g) ?? []).length, 21);
  });
});
