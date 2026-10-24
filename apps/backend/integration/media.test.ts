import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';
import { MAX_UPLOAD_BYTES } from '../src/media/image';

test('Bildverwaltung mit isolierter Datenbank und Upload-Speicher', async (t) => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const url = process.env['TEST_DATABASE_URL'];
  const directory = process.env['UPLOAD_DIR'];
  assert.ok(url && directory);
  assert.equal(new URL(url).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = url;
  const createApp = async () => {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    return app;
  };
  let app = await createApp();
  t.after(async () => { await app.close(); });
  let base = await app.getUrl();
  const db = app.get(PrismaService);
  await db.loginThrottle.deleteMany();
  const admin = await db.adminUser.create({ data: {
    email: 'media@example.com', displayName: 'Media Admin', passwordHash: await hashPassword('Media-test-password!'),
  } });
  const headers = { Origin: 'http://localhost:18432', 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ email: admin.email, password: 'Media-test-password!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const post = (path: string, body: object) => fetch(`${base}${path}`, { method: 'POST',
    headers: { ...headers, Cookie: cookie }, body: JSON.stringify(body) });
  const get = (path: string, auth = false) => fetch(`${base}${path}`, { headers: auth ? { Cookie: cookie } : {} });
  const data = { category: 'DRAWING', title: '<Zeichnung>', altText: 'Eine gruene Zeichnung', description: 'Test & Bild', sortOrder: 5 };
  const source = await sharp({ create: { width: 12, height: 6, channels: 3, background: 'green' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const upload = (buffer: Buffer, metadata: object = data, auth = true, origin = headers.Origin, filename = 'bild.jpg') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), filename);
    form.append('metadata', JSON.stringify(metadata));
    return fetch(`${base}/api/admin/media`, { method: 'POST',
      headers: { Origin: origin, 'X-Olconet-Request': '1', ...(auth ? { Cookie: cookie } : {}) }, body: form });
  };
  let id: string;
  await t.test('Upload und Listen verlangen Sitzung, exakten Ursprung und das vorgesehene Anfrageformat', async () => {
    assert.equal((await get('/api/admin/media')).status, 401);
    assert.equal((await upload(source, data, false)).status, 401);
    assert.equal((await upload(source, data, true, 'https://foreign.example')).status, 403);
    assert.equal((await post('/api/admin/media', data)).status, 403);
    assert.equal((await get('/api/public/media?category=TRAVEL')).status, 400);
    assert.equal((await get('/api/public/media?page=0')).status, 400);
  });
  await t.test('Validierung lehnt defekte und zu grosse Dateien sowie unerlaubte Metadaten ohne gespeicherte Dateien ab', async () => {
    assert.equal((await upload(Buffer.from('not an image'))).status, 400);
    assert.equal((await upload(source, { ...data, altText: 'x'.repeat(501) })).status, 400);
    assert.equal((await upload(source, { ...data, status: 'PUBLISHED' })).status, 400);
    assert.equal((await upload(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).status, 413);
    assert.deepEqual(await readdir(directory), []);
  });
  await t.test('Upload ist privat, wird neu kodiert und gibt keine Speicherschluessel preis', async () => {
    const response = await upload(source, data, true, headers.Origin, '../../secret.jpg');
    assert.equal(response.status, 201);
    id = (await response.json()).id;
    assert.equal((await get(`/api/admin/media/${id}`)).status, 401);
    const detail = await (await get(`/api/admin/media/${id}`, true)).json();
    assert.equal(detail.id, id);
    assert.equal(detail.title, data.title);
    assert.equal(detail.revision, 0);
    assert.equal(detail.storageKey, undefined);
    assert.equal(detail.uploadFingerprint, undefined);
    assert.equal((await get('/api/admin/media/00000000-0000-0000-0000-000000000000', true)).status, 404);
    assert.equal((await get(`/api/admin/media/${id}/image`)).status, 401);
    assert.equal((await get(`/api/public/media/${id}/image`)).status, 404);
    const list = await (await get('/api/admin/media', true)).json();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].status, 'DRAFT');
    assert.equal(list.items[0].storageKey, undefined);
    assert.equal((await (await get('/api/public/media')).json()).total, 0);
    const image = await get(`/api/admin/media/${id}/image`, true);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.equal(metadata.width, 6);
    assert.equal(metadata.height, 12);
    assert.equal(metadata.exif, undefined);
    assert.equal((await readdir(directory)).length, 1);
  });
  await t.test('Bilder und Sitzungen ueberleben einen Backend-Neustart', async () => {
    await app.close();
    app = await createApp(); base = await app.getUrl();
    assert.equal((await get(`/api/admin/media/${id}/image`, true)).status, 200);
  });
  await t.test('Veroeffentlichung schaltet Galerie und Bild frei, oeffentliches Loeschen bleibt gesperrt', async () => {
    assert.equal((await post(`/api/admin/media/${id}/publish`, { revision: 0 })).status, 201);
    const list = await (await get('/api/public/media?category=DRAWING')).json();
    assert.equal(list.total, 1); assert.equal(list.items[0].title, data.title);
    assert.equal(list.items[0].storageKey, undefined);
    assert.equal((await get(`/api/public/media/${id}/image`)).status, 200);
    assert.equal((await post(`/api/admin/media/${id}/delete`, { revision: 1 })).status, 409);
    assert.equal((await (await get('/api/public/media?category=SAMMY')).json()).total, 0);
  });
  await t.test('Metadaten, Kategorie und Reihenfolge sind editierbar; veraltete Revisionen werden abgewiesen', async () => {
    const changes = { ...data, category: 'SAMMY', title: 'Sammy', sortOrder: 1, revision: 1 };
    assert.equal((await post(`/api/admin/media/${id}/save`, changes)).status, 201);
    assert.equal((await post(`/api/admin/media/${id}/save`, changes)).status, 409);
    assert.equal((await (await get('/api/public/media?category=DRAWING')).json()).total, 0);
    assert.equal((await (await get('/api/public/media?category=SAMMY')).json()).items[0].title, 'Sammy');
    const concurrent = await Promise.all([
      post(`/api/admin/media/${id}/save`, { ...changes, revision: 2 }),
      post(`/api/admin/media/${id}/save`, { ...changes, revision: 2 }),
    ]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
  });
  await t.test('Ruecknahme sperrt auch direkte Bild-URLs, Loeschen entfernt die Datei', async () => {
    assert.equal((await post(`/api/admin/media/${id}/unpublish`, { revision: 3 })).status, 201);
    assert.equal((await get(`/api/public/media/${id}/image`)).status, 404);
    assert.equal((await (await get('/api/public/media')).json()).total, 0);
    assert.equal((await post(`/api/admin/media/${id}/delete`, { revision: 3 })).status, 409);
    assert.equal((await post(`/api/admin/media/${id}/delete`, { revision: 4 })).status, 201);
    assert.deepEqual(await readdir(directory), []);
    assert.equal((await get(`/api/admin/media/${id}/image`, true)).status, 404);
  });
  await t.test('Optionale Bildunterschriften und automatische Alternativtexte bleiben nach Upload und Speichern erhalten', async () => {
    for (const title of ['', 'Am See']) {
      const response = await upload(source, { ...data, title, altText: '', titleEn: title ? 'At the lake' : '', altTextEn: '' });
      assert.equal(response.status, 201);
      const asset = await response.json();
      const detail = await (await get(`/api/admin/media/${asset.id}`, true)).json();
      assert.equal(detail.title, title);
      assert.equal(detail.altText, title);
      assert.equal(detail.altTextEn, title ? 'At the lake' : '');
      assert.equal((await post(`/api/admin/media/${asset.id}/save`, {
        ...data, title: '', altText: '', titleEn: '', altTextEn: '', revision: 0,
      })).status, 201);
      const cleared = await (await get(`/api/admin/media/${asset.id}`, true)).json();
      assert.equal(cleared.title, '');
      assert.equal(cleared.altText, '');
      assert.equal(cleared.altTextEn, '');
      assert.equal((await post(`/api/admin/media/${asset.id}/delete`, { revision: 1 })).status, 201);
    }
    assert.deepEqual(await readdir(directory), []);
  });
  await t.test('Galerie-Pagination und Sortierung werden eingehalten', async () => {
    const prisma = app.get(PrismaService);
    await prisma.mediaAsset.createMany({ data: Array.from({ length: 22 }, (_, index) => ({
      ...data, storageKey: `pagination-${index}`, originalName: 'fixture', mimeType: 'image/webp', byteSize: 1,
      sortOrder: index, status: index === 21 ? 'DRAFT' : 'PUBLISHED',
    })) });
    const page = await (await get('/api/public/media?category=DRAWING')).json();
    assert.equal(page.total, 21); assert.equal(page.items.length, 20);
    assert.equal(page.items[0].sortOrder, 0);
    assert.equal((await (await get('/api/public/media?category=DRAWING&page=2')).json()).items.length, 1);
    await prisma.mediaAsset.deleteMany({ where: { originalName: 'fixture' } });
  });
  await t.test('Multi-Fotogruppen sind eine gemeinsame Verwaltungs-, Sortier- und Veroeffentlichungseinheit', async () => {
    const groupData = { ...data, category: 'SAMMY', sortOrder: 0 };
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await upload(source, groupData);
      assert.equal(response.status, 201);
      ids.push((await response.json()).id);
    }
    const [parent, child] = ids;
    const grouping = { ids };
    const unauthenticated = await fetch(`${base}/api/admin/media/group`, { method: 'POST', headers, body: JSON.stringify(grouping) });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await post('/api/admin/media/group', grouping)).status, 201);
    assert.equal((await post('/api/admin/media/group', grouping)).status, 201);
    let detail = await (await get(`/api/admin/media/${parent}`, true)).json();
    assert.deepEqual(detail.children.map((item: { id: string }) => item.id), ids.slice(1));
    assert.equal(detail.revision, 1);
    assert.equal((await (await get('/api/admin/media?category=SAMMY', true)).json()).total, 1);
    assert.equal((await (await get('/api/admin/overview', true)).json()).sammyPhotos, 1);
    assert.equal((await (await get('/api/public/media?category=SAMMY')).json()).total, 0);
    for (const photo of ids) assert.equal((await get(`/api/public/media/${photo}/image`)).status, 404);
    assert.equal((await get(`/api/admin/media/${child}`, true)).status, 404);
    for (const action of ['publish', 'unpublish', 'delete']) {
      assert.equal((await post(`/api/admin/media/${child}/${action}`, { revision: 1 })).status, 409);
    }
    assert.equal((await post(`/api/admin/media/${child}/save`, { ...groupData, revision: 1 })).status, 409);
    assert.equal((await post(`/api/admin/media/${parent}/save`, { ...groupData, category: 'TRAVEL', revision: 1 })).status, 400);
    assert.equal((await post(`/api/admin/media/${parent}/publish`, { revision: 1 })).status, 201);
    for (const photo of ids) assert.equal((await get(`/api/public/media/${photo}/image`)).status, 200);
    await db.mediaAsset.createMany({ data: Array.from({ length: 20 }, (_, i) => ({
      ...groupData, storageKey: `group-pagination-${i}`, originalName: 'group-fixture', mimeType: 'image/webp',
      byteSize: 1, sortOrder: i + 10, status: 'PUBLISHED',
    })) });
    const firstPage = await (await get('/api/public/media?category=SAMMY')).json();
    assert.equal(firstPage.total, 21);
    assert.equal(firstPage.items.length, 20);
    assert.equal(firstPage.items[0].id, parent);
    assert.equal(firstPage.items[0].children.length, 2);
    assert.equal((await (await get('/api/public/media?category=SAMMY&page=2')).json()).items.length, 1);
    const order = await (await get('/api/admin/media/order?category=SAMMY', true)).json();
    assert.equal(order.total, 21);
    assert.equal(order.items[0]._count.children, 2);
    assert.equal((await post('/api/admin/media/order/move', { category: 'SAMMY', assetId: child, position: 21, token: order.token })).status, 404);
    assert.equal((await post('/api/admin/media/order/move', { category: 'SAMMY', assetId: parent, position: 21, token: order.token })).status, 201);
    const secondPage = await (await get('/api/public/media?category=SAMMY&page=2')).json();
    assert.equal(secondPage.items[0].id, parent);
    assert.deepEqual(secondPage.items[0].children.map((item: { id: string }) => item.id), ids.slice(1));
    detail = await (await get(`/api/admin/media/${parent}`, true)).json();
    const changes = { ...groupData, category: 'DRAWING', title: 'Gemeinsamer Titel', altText: 'Gemeinsamer Alternativtext', revision: detail.revision };
    assert.equal((await post(`/api/admin/media/${parent}/save`, changes)).status, 201);
    assert.equal((await post(`/api/admin/media/${parent}/save`, changes)).status, 409);
    const photos = await db.mediaAsset.findMany({ where: { id: { in: ids } } });
    assert.ok(photos.every(photo => photo.title === changes.title && photo.altText === changes.altText && photo.category === 'DRAWING'));
    const publicGroup = await (await get('/api/public/media?category=DRAWING')).json();
    assert.equal(publicGroup.total, 1);
    assert.equal(publicGroup.items[0].title, changes.title);
    assert.equal(publicGroup.items[0].children.length, 2);
    detail = await (await get(`/api/admin/media/${parent}`, true)).json();
    assert.equal((await post(`/api/admin/media/${parent}/delete`, { revision: detail.revision })).status, 409);
    assert.equal((await post(`/api/admin/media/${parent}/unpublish`, { revision: detail.revision })).status, 201);
    for (const photo of ids) assert.equal((await get(`/api/public/media/${photo}/image`)).status, 404);
    assert.equal((await post(`/api/admin/media/${parent}/delete`, { revision: detail.revision + 1 })).status, 201);
    assert.equal(await db.mediaAsset.count({ where: { id: { in: ids } } }), 0);
    assert.deepEqual(await readdir(directory), []);
    await db.mediaAsset.deleteMany({ where: { originalName: 'group-fixture' } });
  });
  await t.test('Gruppierung lehnt Reisebilder, gemischte Kategorien und abweichende gemeinsame Angaben ab', async () => {
    const first = (await (await upload(source)).json()).id;
    const second = (await (await upload(source, { ...data, category: 'TRAVEL' })).json()).id;
    assert.equal((await post('/api/admin/media/group', { ids: [first, second] })).status, 409);
    assert.equal((await post('/api/admin/media/group', { ids: [first, first] })).status, 400);
    assert.equal((await post('/api/admin/media/group', { ids: [first] })).status, 400);
    const other = (await (await upload(source, { ...data, altText: 'Abweichender Alternativtext' })).json()).id;
    assert.equal((await post('/api/admin/media/group', { ids: [first, other] })).status, 409);
    for (const photo of [first, second, other]) {
      assert.equal((await post(`/api/admin/media/${photo}/delete`, { revision: 0 })).status, 201);
    }
    assert.deepEqual(await readdir(directory), []);
  });
});
