import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';

interface PageInput { id: string; title: string; contentHtml: string; galleryImages: { assetId: string; caption: string }[]; }
interface Report { id: string; version: number; status: string; pages: { id: string; title: string; status: string }[]; }

test('Mehrseitige Reiseberichte mit einzeln veroeffentlichten Seiten', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const url = process.env['TEST_DATABASE_URL'];
  assert.ok(url && process.env['UPLOAD_DIR']);
  assert.equal(new URL(url).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = url;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app); await app.listen(0, '127.0.0.1');
  const db = app.get(PrismaService);
  await db.loginThrottle.deleteMany();
  const admin = await db.adminUser.create({ data: { email: 'pages@example.com', displayName: 'Pages',
    passwordHash: await hashPassword('Report-pages-password!') } });
  const base = await app.getUrl();
  const headers = { Origin: 'http://localhost:18432', 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ email: admin.email, password: 'Report-pages-password!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const post = (path: string, body: object, auth = true, origin = headers.Origin) => fetch(`${base}${path}`, {
    method: 'POST', headers: { ...headers, Origin: origin, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  const get = (path: string, auth = false) => fetch(`${base}${path}`, { headers: auth ? { Cookie: cookie } : {} });
  const source = await sharp({ create: { width: 16, height: 8, channels: 3, background: 'blue' } }).png().toBuffer();
  const assets: string[] = [];
  t.after(async () => {
    try {
      await db.travelReport.deleteMany({ where: { authorId: admin.id } });
      for (const id of assets) assert.equal((await post(`/api/admin/media/${id}/delete`, { revision: 0 })).status, 201);
      await db.adminUser.delete({ where: { id: admin.id } });
    } finally { await app.close(); }
  });
  for (let i = 0; i < 4; i++) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(source)], { type: 'image/png' }), 'reise.png');
    form.append('metadata', JSON.stringify({ category: 'TRAVEL', title: `Reisebild ${i}`, altText: `Foto ${i}`, description: '', sortOrder: 0 }));
    const response = await fetch(`${base}/api/admin/media`, { method: 'POST',
      headers: { Origin: headers.Origin, 'X-Olconet-Request': '1', Cookie: cookie }, body: form });
    assert.equal(response.status, 201); assets.push((await response.json()).id);
  }
  const page = (title: string, contentHtml: string, ids: string[]): PageInput => ({
    id: randomUUID(), title, contentHtml, galleryImages: ids.map(assetId => ({ assetId, caption: title })),
  });
  const first = page('Anreise', `<p>Anreise</p><figure><img data-asset-id="${assets[0]}"></figure>`, [assets[1]!]);
  const draft = page('Geheime Entwurfsseite', `<p>Privater Text</p><figure><img data-asset-id="${assets[2]}"></figure>`, [assets[0]!]);
  const photos = page('Fototag', '', [assets[3]!]);
  let pages = [first, draft, photos];
  const metadata = { title: 'Mehrseitige Reise', slug: 'mehrseitige-reise', excerpt: 'Unterwegs',
    destination: '', travelStart: '', travelEnd: '' };
  let report: Report;
  const status = (id: string, publish: boolean, version = report.version) =>
    post(`/api/admin/reports/${report.id}/pages/${id}/${publish ? 'publish' : 'unpublish'}`, { version });
  const image = (index: number) => get(`/api/public/reports/${metadata.slug}/images/${assets[index]}`);
  const save = () => post(`/api/admin/reports/${report.id}/save`, { ...metadata, pages, version: report.version });
  const refresh = async () => { report = await (await get(`/api/admin/reports/${report.id}`, true)).json(); };

  await t.test('Migration bewahrt bestehende Texte, Bildzuordnungen und Veroeffentlichungszustaende als erste Seite', async () => {
    const schema = `pages_migration_${randomUUID().replaceAll('-', '')}`;
    const migration = await readFile(resolve('prisma/migrations/20261016150000_report_pages/migration.sql'), 'utf8');
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(`CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED')`);
      await tx.$executeRawUnsafe(`CREATE TABLE "TravelReport" ("id" UUID PRIMARY KEY, "contentHtml" TEXT,
        "status" "PublicationStatus", "publishedAt" TIMESTAMPTZ(3))`);
      await tx.$executeRawUnsafe(`CREATE TABLE "ReportImage" ("reportId" UUID, "assetId" UUID,
        CONSTRAINT "ReportImage_pkey" PRIMARY KEY ("reportId", "assetId"))`);
      await tx.$executeRawUnsafe(`INSERT INTO "TravelReport" VALUES ($1::uuid, '<p>Alter Text</p>', 'PUBLISHED', '2026-01-01'),
        ($2::uuid, '<p>Privat</p>', 'DRAFT', NULL)`, first.id, draft.id);
      await tx.$executeRawUnsafe(`INSERT INTO "ReportImage" VALUES ($1::uuid, $2::uuid)`, first.id, assets[0]);
      for (const statement of migration.split(';').filter(statement => statement.trim())) await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRawUnsafe<{ id: string; contentHtml: string; status: string; publishedAt: Date | null }[]>(
        `SELECT "id", "contentHtml", "status", "publishedAt" FROM "ReportPage" ORDER BY "contentHtml"`);
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.contentHtml, '<p>Alter Text</p>'); assert.equal(rows[0]!.status, 'PUBLISHED');
      assert.ok(rows[0]!.publishedAt);
      assert.equal(rows[1]!.status, 'DRAFT'); assert.equal(rows[1]!.publishedAt, null);
      const images = await tx.$queryRawUnsafe<{ reportId: string; pageId: string; assetId: string }[]>(`SELECT * FROM "ReportImage"`);
      assert.deepEqual(images, [{ reportId: first.id, pageId: first.id, assetId: assets[0] }]);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  });

  await t.test('Mehrere Seiten werden privat angelegt, Bildzuordnungen gelten fuer die jeweilige Seite', async () => {
    const response = await post('/api/admin/reports', { ...metadata, pages });
    assert.equal(response.status, 201); report = await response.json();
    assert.equal(report.status, 'DRAFT'); assert.equal(report.pages.length, 3);
    assert.ok(report.pages.every(page => page.status === 'DRAFT'));
    assert.equal((await get(`/api/public/reports/${metadata.slug}`)).status, 404);
    for (let i = 0; i < assets.length; i++) assert.equal((await image(i)).status, 404);
  });
  await t.test('Erste Seite schaltet Bericht und RSS frei, niemals Entwurfsseiten oder deren eigene Fotos', async () => {
    const path = `/api/admin/reports/${report.id}/pages/${first.id}/publish`;
    assert.equal((await post(path, { version: report.version }, false)).status, 401);
    assert.equal((await post(path, { version: report.version }, true, 'https://foreign.example')).status, 403);
    assert.equal((await status(first.id, true)).status, 201); await refresh();
    assert.equal(report.status, 'PUBLISHED');
    const response = await get(`/api/public/reports/${metadata.slug}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.pages.map((page: { id: string }) => page.id), [first.id]);
    assert.doesNotMatch(JSON.stringify(body), /Geheime|Privater|storageKey|pageId|reportId/);
    assert.equal((await image(0)).status, 200); assert.equal((await image(1)).status, 200);
    assert.equal((await image(2)).status, 404); assert.equal((await image(3)).status, 404);
    assert.match(await (await get('/api/public/reports/rss')).text(), /mehrseitige-reise/);
  });
  await t.test('Fotoseiten koennen einzeln veroeffentlicht und Seiten ohne unbeabsichtigte Freigabe umsortiert werden', async () => {
    assert.equal((await status(photos.id, true)).status, 201); await refresh();
    const extra = page('Neuer privater Entwurf', '<p>Neu</p>', []);
    pages = [photos, draft, first, extra];
    assert.equal((await save()).status, 201); await refresh();
    assert.equal(report.pages[1]!.status, 'DRAFT'); assert.equal(report.pages[3]!.status, 'DRAFT');
    const body = await (await get(`/api/public/reports/${metadata.slug}`)).json();
    assert.deepEqual(body.pages.map((page: { id: string }) => page.id), [photos.id, first.id]);
    assert.equal(body.contentHtml, '');
    assert.equal((await image(3)).status, 200); assert.equal((await image(2)).status, 404);
  });
  await t.test('Falsche Kategorien, fremde Seiten-IDs, alte Clients und veraltete Versionen koennen keine Seiten ueberschreiben', async () => {
    const oldVersion = report.version;
    assert.equal((await post(`/api/admin/reports/${report.id}/save`, { ...metadata, contentHtml: '<p>Alt</p>', version: report.version })).status, 409);
    const bad = [...pages, page('Fehler', '', [randomUUID()])];
    assert.equal((await post(`/api/admin/reports/${report.id}/save`, { ...metadata, pages: bad, version: report.version })).status, 400);
    const other = await (await post('/api/admin/reports', { ...metadata, slug: 'andere-seiten', pages: [page('Andere Seite', 'Test', [])] })).json();
    const otherPage = other.pages[0].id;
    assert.equal((await status(otherPage, true)).status, 404);
    assert.equal((await post(`/api/admin/reports/${report.id}/save`, {
      ...metadata, pages: [...pages, { ...pages[0], id: otherPage }], version: report.version,
    })).status, 409);
    await refresh(); assert.equal(report.version, oldVersion);
    assert.equal((await save()).status, 201); await refresh();
    assert.equal((await status(first.id, false, oldVersion)).status, 409);
    const concurrent = await Promise.all([status(first.id, true), status(photos.id, true)]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
    await refresh();
  });
  await t.test('Ruecknahme sperrt eigene Bilder sofort; letzte veroeffentlichte Seite entfernt Bericht und RSS-Eintrag', async () => {
    assert.equal((await status(first.id, false)).status, 201); await refresh();
    assert.equal((await image(0)).status, 404); assert.equal((await image(1)).status, 404);
    assert.equal((await image(3)).status, 200);
    assert.equal((await status(photos.id, false)).status, 201); await refresh();
    assert.equal(report.status, 'DRAFT');
    assert.equal((await get(`/api/public/reports/${metadata.slug}`)).status, 404);
    assert.doesNotMatch(await (await get('/api/public/reports/rss')).text(), /mehrseitige-reise/);
    assert.equal((await image(3)).status, 404);
  });
  await t.test('Geloeschte veroeffentlichte Seiten und alle Seiten zuruecknehmen aktualisieren Sichtbarkeit atomar', async () => {
    assert.equal((await status(first.id, true)).status, 201); await refresh();
    pages = pages.filter(page => page.id !== first.id);
    assert.equal((await save()).status, 201); await refresh();
    assert.equal(report.status, 'DRAFT');
    assert.equal((await image(0)).status, 404);
    assert.equal((await status(photos.id, true)).status, 201); await refresh();
    assert.equal((await status(draft.id, true)).status, 201); await refresh();
    assert.equal((await image(0)).status, 200);
    assert.equal((await post(`/api/admin/reports/${report.id}/unpublish`, { version: report.version })).status, 201);
    await refresh();
    assert.ok(report.pages.every(page => page.status === 'DRAFT'));
    assert.equal((await image(0)).status, 404);
    assert.equal((await post(`/api/admin/reports/${report.id}/delete`, { version: report.version })).status, 201);
    assert.equal(await db.reportPage.count({ where: { reportId: report.id } }), 0);
    assert.equal(await db.reportImage.count({ where: { reportId: report.id } }), 0);
  });
});
