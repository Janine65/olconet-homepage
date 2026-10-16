import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';

test('Englische Inhalte, sichere Veroeffentlichung und deutscher Ersatz', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const url = process.env['TEST_DATABASE_URL'];
  assert.ok(url && process.env['UPLOAD_DIR']);
  assert.equal(new URL(url).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = url;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app); await app.listen(0, '127.0.0.1');
  const db = app.get(PrismaService);
  await db.loginThrottle.deleteMany();
  const user = await db.adminUser.create({ data: { email: 'english@example.com', displayName: 'English',
    passwordHash: await hashPassword('English-test-password!') } });
  const base = await app.getUrl();
  const headers = { Origin: 'http://localhost:18432', 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ email: user.email, password: 'English-test-password!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string, auth = false) => fetch(base + path, { headers: auth ? { Cookie: cookie } : {} });
  const post = (path: string, body: object) => fetch(base + path, { method: 'POST',
    headers: { ...headers, Cookie: cookie }, body: JSON.stringify(body) });
  const assets: string[] = [];
  t.after(async () => {
    try {
      await db.travelReport.deleteMany({ where: { authorId: user.id } });
      for (const id of assets) {
        let asset = await db.mediaAsset.findUnique({ where: { id } });
        if (!asset || asset.parentId) continue;
        if (asset.status === 'PUBLISHED') {
          assert.equal((await post(`/api/admin/media/${id}/unpublish`, { revision: asset.revision })).status, 201);
          asset = await db.mediaAsset.findUniqueOrThrow({ where: { id } });
        }
        assert.equal((await post(`/api/admin/media/${id}/delete`, { revision: asset.revision })).status, 201);
      }
      await db.adminUser.delete({ where: { id: user.id } });
    } finally { await app.close(); }
  });
  const source = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'green' } }).png().toBuffer();
  for (const category of ['SAMMY', 'SAMMY', 'TRAVEL', 'TRAVEL', 'TRAVEL']) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(source)], { type: 'image/png' }), 'foto.png');
    form.append('metadata', JSON.stringify({ category, title: 'Am See', titleEn: 'At the lake', altText: 'See mit Hund',
      altTextEn: 'Lake and dog', description: 'Deutsche Beschreibung', descriptionEn: '', sortOrder: 0 }));
    const response = await fetch(base + '/api/admin/media', { method: 'POST',
      headers: { Origin: headers.Origin, 'X-Olconet-Request': '1', Cookie: cookie }, body: form });
    assert.equal(response.status, 201); assets.push((await response.json()).id);
  }
  const metadata = { title: 'Reise', titleEn: 'Trip', slug: 'english-test', excerpt: 'Deutsche Kurzbeschreibung', excerptEn: '',
    destination: 'Schweiz', destinationEn: 'Switzerland', travelStart: '', travelEnd: '' };
  const pages = [
    { id: randomUUID(), title: 'Anreise', titleEn: 'Arrival', contentHtml: '<p>Deutscher Text</p>',
      contentHtmlEn: `<p onclick="bad">English text<script>secret</script></p><figure><img data-asset-id="${assets[2]}" data-image-size="100"></figure>`,
      galleryImages: [] as { assetId: string; caption: string; captionEn: string }[] },
    { id: randomUUID(), title: 'Nur Deutsch', titleEn: '', contentHtml: '<p>Deutscher Ersatz</p>', contentHtmlEn: '<p><br></p>',
      galleryImages: [{ assetId: assets[3]!, caption: 'Deutsche Unterschrift', captionEn: 'English caption' }] },
    { id: randomUUID(), title: 'Privat', titleEn: 'Private draft', contentHtml: '<p>Privat</p>',
      contentHtmlEn: `<p>Private English draft</p><figure><img data-asset-id="${assets[4]}"></figure>`, galleryImages: [] },
  ];
  let report: { id: string; version: number };

  await t.test('Uebersetzungen werden gespeichert, Entwuerfe bleiben in beiden Sprachen privat', async () => {
    const response = await post('/api/admin/reports', { ...metadata, pages });
    assert.equal(response.status, 201); report = await response.json();
    assert.equal((await get('/api/public/reports/english-test?lang=en')).status, 404);
    const stored = await (await get(`/api/admin/reports/${report.id}`, true)).json();
    assert.equal(stored.titleEn, 'Trip');
    assert.equal(stored.pages[0].titleEn, 'Arrival');
    assert.match(stored.pages[0].contentHtmlEn, /English text/);
    assert.doesNotMatch(stored.pages[0].contentHtmlEn, /onclick|secret|script/);
    assert.equal((await get(`/api/public/reports/english-test/images/${assets[2]}`)).status, 404);
    for (const page of pages.slice(0, 2)) {
      const response = await post(`/api/admin/reports/${report.id}/pages/${page.id}/publish`, { version: report.version });
      assert.equal(response.status, 201); report = await response.json();
    }
  });
  await t.test('Public-API, RSS und Bilder liefern Uebersetzungen mit feldweisem Ersatz ohne Entwurfslecks', async () => {
    const english = await (await get('/api/public/reports/english-test?lang=en')).json();
    assert.equal(english.title, 'Trip'); assert.equal(english.destination, 'Switzerland');
    assert.equal(english.excerpt, metadata.excerpt); assert.equal(english.pages.length, 2);
    assert.equal(english.pages[0].title, 'Arrival');
    assert.match(english.pages[0].contentHtml, /English text/);
    assert.match(english.pages[0].contentHtml, /alt="Lake and dog"/);
    assert.match(english.pages[0].contentHtml, /width="100" height="100"/);
    assert.equal(english.pages[1].title, 'Nur Deutsch');
    assert.equal(english.pages[1].contentHtml, '<p>Deutscher Ersatz</p>');
    assert.equal(english.pages[1].images[0].caption, 'English caption');
    assert.doesNotMatch(JSON.stringify(english), /Private English draft|Private draft/);
    assert.equal((await get(`/api/public/reports/english-test/images/${assets[2]}`)).status, 200);
    assert.equal((await get(`/api/public/reports/english-test/images/${assets[4]}`)).status, 404);
    const german = await (await get('/api/public/reports/english-test')).json();
    assert.equal(german.title, 'Reise'); assert.equal(german.pages[0].contentHtml, '<p>Deutscher Text</p>');
    assert.equal(german.pages[1].images[0].caption, 'Deutsche Unterschrift');
    const list = await (await get('/api/public/reports?lang=en')).json();
    assert.equal(list.items.find((item: { id: string }) => item.id === report.id).title, 'Trip');
    const feed = await (await get('/api/public/reports/rss?lang=en')).text();
    assert.match(feed, /<title>Trip<\/title>/); assert.match(feed, /<language>en<\/language>/);
    assert.match(feed, /\/en\/reisen\/bericht/);
    for (const endpoint of ['/api/public/media', '/api/public/reports', '/api/public/reports/rss', '/api/public/reports/english-test']) {
      assert.equal((await get(endpoint + '?lang=fr')).status, 400);
    }
  });
  await t.test('Alte Speicheranfragen erhalten vorhandene Uebersetzungen und englische Bildzuordnungen', async () => {
    const { titleEn: _title, excerptEn: _excerpt, destinationEn: _destination, ...oldMetadata } = metadata;
    const oldPages = pages.map(({ titleEn: _title, contentHtmlEn: _content, galleryImages, ...page }) => ({
      ...page, galleryImages: galleryImages.map(({ captionEn: _caption, ...image }) => image),
    }));
    const response = await post(`/api/admin/reports/${report.id}/save`, { ...oldMetadata, pages: oldPages, version: report.version });
    assert.equal(response.status, 201); report = await response.json();
    const english = await (await get('/api/public/reports/english-test?lang=en')).json();
    assert.equal(english.title, 'Trip'); assert.match(english.pages[0].contentHtml, /English text/);
    assert.equal(english.pages[1].images[0].caption, 'English caption');
    assert.equal((await get(`/api/public/reports/english-test/images/${assets[2]}`)).status, 200);
  });
  await t.test('Bewusst geleerte Uebersetzungen aktivieren den Ersatz und entfernen englische Bildzuordnungen', async () => {
    const response = await post(`/api/admin/reports/${report.id}/save`, {
      ...metadata, titleEn: '', pages: pages.map(page => ({
        ...page, titleEn: '', contentHtmlEn: '<p></p>', galleryImages: page.galleryImages.map(image => ({ ...image, captionEn: '' })),
      })), version: report.version,
    });
    assert.equal(response.status, 201); report = await response.json();
    const english = await (await get('/api/public/reports/english-test?lang=en')).json();
    assert.equal(english.title, 'Reise'); assert.equal(english.pages[0].title, 'Anreise');
    assert.equal(english.pages[0].contentHtml, '<p>Deutscher Text</p>');
    assert.equal(english.pages[1].images[0].caption, 'Deutsche Unterschrift');
    assert.equal((await get(`/api/public/reports/english-test/images/${assets[2]}`)).status, 404);
  });
  await t.test('Bilinguale Texte ueber 128 KiB funktionieren, ungueltige englische Bilder rollen die Speicherung zurueck', async () => {
    const large = pages.map((page, index) => index ? page : { ...page, contentHtml: 'd'.repeat(80000), contentHtmlEn: 'e'.repeat(80000) });
    let response = await post(`/api/admin/reports/${report.id}/save`, { ...metadata, pages: large, version: report.version });
    assert.equal(response.status, 201); report = await response.json();
    response = await post(`/api/admin/reports/${report.id}/save`, {
      ...metadata, pages: pages.map((page, index) => index ? page : { ...page, contentHtmlEn: `<img data-asset-id="${assets[0]}">` }),
      version: report.version,
    });
    assert.equal(response.status, 400);
    const stored = await (await get(`/api/admin/reports/${report.id}`, true)).json();
    assert.equal(stored.version, report.version);
    assert.equal(stored.pages[0].contentHtmlEn.length, 80000);
  });
  await t.test('Maximal lange zweisprachige UTF-8-Bildmetadaten passen in das Multipart-Limit', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(source)], { type: 'image/png' }), 'utf8.png');
    form.append('metadata', JSON.stringify({ category: 'TRAVEL', title: '\u4e00'.repeat(200), titleEn: '\u4e00'.repeat(200),
      altText: '\u4e00'.repeat(500), altTextEn: '\u4e00'.repeat(500),
      description: '\u4e00'.repeat(2000), descriptionEn: '\u4e00'.repeat(2000), sortOrder: 0 }));
    const response = await fetch(base + '/api/admin/media', { method: 'POST',
      headers: { Origin: headers.Origin, 'X-Olconet-Request': '1', Cookie: cookie }, body: form });
    assert.equal(response.status, 201); assets.push((await response.json()).id);
  });
  await t.test('Fotogruppen bearbeiten und veroeffentlichen englische Angaben gemeinsam; alte Clients loeschen sie nicht', async () => {
    assert.equal((await post('/api/admin/media/group', { ids: assets.slice(0, 2) })).status, 201);
    const id = assets[0]!;
    let asset = await (await get(`/api/admin/media/${id}`, true)).json();
    const update = { category: 'SAMMY', title: 'Hund', altText: 'Hund am See', description: 'Deutsch', sortOrder: 0 };
    assert.equal((await post(`/api/admin/media/${id}/save`, { ...update, titleEn: 'Dog', altTextEn: '', descriptionEn: 'English',
      revision: asset.revision })).status, 201);
    asset = await (await get(`/api/admin/media/${id}`, true)).json();
    assert.equal((await post(`/api/admin/media/${id}/save`, { ...update, revision: asset.revision })).status, 201);
    asset = await (await get(`/api/admin/media/${id}`, true)).json();
    assert.equal((await post(`/api/admin/media/${id}/publish`, { revision: asset.revision })).status, 201);
    const english = await (await get('/api/public/media?category=SAMMY&lang=en')).json();
    const group = english.items.find((item: { id: string }) => item.id === id);
    assert.equal(group.title, 'Dog'); assert.equal(group.altText, 'Hund am See'); assert.equal(group.description, 'English');
    assert.equal(group.children.length, 1);
    const child = await db.mediaAsset.findUniqueOrThrow({ where: { id: assets[1] } });
    assert.equal(child.titleEn, 'Dog'); assert.equal(child.altTextEn, ''); assert.equal(child.descriptionEn, 'English');
    const german = await (await get('/api/public/media?category=SAMMY')).json();
    assert.equal(german.items.find((item: { id: string }) => item.id === id).title, 'Hund');
  });
});
