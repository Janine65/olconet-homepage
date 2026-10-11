import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';

interface Report { id: string; version: number; images: { assetId: string; inGallery: boolean; caption: string | null }[]; contentHtml: string; }
test('Reisebilder im Text, Galerie und sichere Upload-Wiederholung', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  assert.ok(databaseUrl && process.env['UPLOAD_DIR']);
  assert.equal(new URL(databaseUrl).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = databaseUrl;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); });
  const db = app.get(PrismaService);
  await db.loginThrottle.deleteMany();
  const admin = await db.adminUser.create({ data: { email: 'report-images@example.com', displayName: 'Images',
    passwordHash: await hashPassword('Report-images-password!') } });
  const base = await app.getUrl();
  const headers = { Origin: 'http://localhost:18432', 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ email: admin.email, password: 'Report-images-password!' }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const post = (path: string, body: object) => fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify(body) });
  const get = (path: string, auth = false) => fetch(`${base}${path}`, { headers: auth ? { Cookie: cookie } : {} });
  const source = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'blue' } }).png().toBuffer();
  const metadata = { category: 'TRAVEL', title: 'See', altText: 'Blauer See', description: '', sortOrder: 0, uploadKey: randomUUID() };
  const upload = async (data = metadata) => {
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(source)], { type: 'image/png' }), 'see.png');
    body.append('metadata', JSON.stringify(data));
    return fetch(`${base}/api/admin/media`, { method: 'POST',
      headers: { Origin: headers.Origin, 'X-Olconet-Request': '1', Cookie: cookie }, body });
  };
  let first: string; let second: string; let report: Report;
  const text = (id: string) => `<p>Am See</p><figure><img data-asset-id="${id}" src="https://foreign.example"><figcaption>Im Text &amp; See</figcaption></figure>`;
  const input = { title: 'Reisebilder', slug: 'reisebilder', excerpt: 'Am See', destination: '', travelStart: '', travelEnd: '', contentHtml: '<p>Am See</p>' };
  await t.test('Mehrfachversuche desselben Uploads speichern exakt eine Datei, auch gleichzeitig', async () => {
    const responses = await Promise.all([upload(), upload()]);
    assert.deepEqual(responses.map(r => r.status), [201, 201]);
    first = (await responses[0].json()).id;
    assert.equal((await responses[1].json()).id, first);
    assert.equal((await readdir(process.env['UPLOAD_DIR']!)).length, 1);
    assert.equal((await upload({ ...metadata, title: 'Anderer Titel' })).status, 409);
    second = (await (await upload({ ...metadata, title: 'Berge', uploadKey: randomUUID() })).json()).id;
    assert.equal((await post(`/api/admin/media/${first}/publish`, { revision: 0 })).status, 400);
    assert.equal((await get(`/api/public/media/${first}/image`)).status, 404);
    assert.equal((await get('/api/public/media?category=TRAVEL')).status, 400);
  });
  await t.test('Galerie und Inline-Bilder werden atomar mit dem Entwurf gespeichert und bleiben privat', async () => {
    const response = await post('/api/admin/reports', { ...input, contentHtml: text(first),
      galleryImages: [{ assetId: second, caption: 'Berge' }, { assetId: first, caption: 'Galerie See' }] });
    assert.equal(response.status, 201);
    report = await response.json();
    assert.deepEqual(report.images.map(image => image.assetId), [second, first]);
    assert.doesNotMatch(report.contentHtml, /foreign/);
    assert.equal((await get(`/api/public/reports/reisebilder/images/${first}`)).status, 404);
    assert.equal((await post(`/api/admin/media/${first}/delete`, { revision: 0 })).status, 409);
    assert.equal((await post(`/api/admin/media/${first}/save`, { ...metadata, uploadKey: undefined, category: 'SAMMY', revision: 0 })).status, 409);
  });
  await t.test('Fehlende oder falsche Bildkategorien rollen die gesamte Berichtsspeicherung zurueck', async () => {
    const wrong = await db.mediaAsset.create({ data: { category: 'DRAWING', title: 'Falsch', altText: 'Falsch',
      storageKey: 'fixture', originalName: 'fixture', mimeType: 'image/webp', byteSize: 1 } });
    for (const id of [randomUUID(), wrong.id]) {
      assert.equal((await post(`/api/admin/reports/${report.id}/save`, { ...input, version: report.version,
        galleryImages: [{ assetId: id, caption: '' }] })).status, 400);
    }
    const persisted = await (await get(`/api/admin/reports/${report.id}`, true)).json();
    assert.equal(persisted.version, report.version);
    assert.equal(persisted.images.length, 2);
    await db.mediaAsset.delete({ where: { id: wrong.id } });
  });
  await t.test('Veroeffentlichung gibt nur zugeordnete Bilder unter berichtsspezifischen URLs frei', async () => {
    report = await (await post(`/api/admin/reports/${report.id}/publish`, { version: report.version })).json();
    const published = await (await get('/api/public/reports/reisebilder')).json();
    assert.match(published.contentHtml, new RegExp(`/api/public/reports/reisebilder/images/${first}`));
    assert.match(published.contentHtml, /alt="Blauer See"/);
    assert.equal(published.images[0].asset.storageKey, undefined);
    assert.equal((await get(`/api/public/reports/reisebilder/images/${first}`)).headers.get('content-type'), 'image/webp');
    assert.equal((await get(`/api/public/media/${first}/image`)).status, 404);
    assert.equal((await get(`/api/public/reports/not-this-report/images/${first}`)).status, 404);
  });
  await t.test('Galerie-Reihenfolge und Inline-only werden gespeichert, entfernte Bilder sofort gesperrt', async () => {
    const response = await post(`/api/admin/reports/${report.id}/save`, { ...input, contentHtml: text(first), version: report.version,
      galleryImages: [{ assetId: second, caption: 'Nur Berge in Galerie' }] });
    assert.equal(response.status, 201); report = await response.json();
    assert.equal(report.images.find(image => image.assetId === first)!.inGallery, false);
    assert.equal((await get(`/api/public/reports/reisebilder/images/${first}`)).status, 200);
    report = await (await post(`/api/admin/reports/${report.id}/save`, { ...input, version: report.version,
      galleryImages: [{ assetId: second, caption: '' }] })).json();
    assert.equal((await get(`/api/public/reports/reisebilder/images/${first}`)).status, 404);
  });
  await t.test('Ruecknahme und Loeschen loesen Zuordnungen, ohne gemeinsam verwendete Dateien zu loeschen', async () => {
    const shared: Report = await (await post('/api/admin/reports', { ...input, slug: 'gemeinsam',
      galleryImages: [{ assetId: second, caption: '' }] })).json();
    await post(`/api/admin/reports/${shared.id}/publish`, { version: shared.version });
    report = await (await post(`/api/admin/reports/${report.id}/unpublish`, { version: report.version })).json();
    assert.equal((await get(`/api/public/reports/reisebilder/images/${second}`)).status, 404);
    assert.equal((await get(`/api/public/reports/gemeinsam/images/${second}`)).status, 200);
    await post(`/api/admin/reports/${report.id}/delete`, { version: report.version });
    assert.equal((await post(`/api/admin/media/${second}/delete`, { revision: 0 })).status, 409);
    const sharedPublished: Report = await (await get(`/api/admin/reports/${shared.id}`, true)).json();
    const sharedDraft: Report = await (await post(`/api/admin/reports/${shared.id}/unpublish`, { version: sharedPublished.version })).json();
    await post(`/api/admin/reports/${shared.id}/delete`, { version: sharedDraft.version });
    assert.equal((await post(`/api/admin/media/${first}/delete`, { revision: 0 })).status, 201);
    assert.equal((await post(`/api/admin/media/${second}/delete`, { revision: 0 })).status, 201);
    assert.deepEqual(await readdir(process.env['UPLOAD_DIR']!), []);
  });
});
