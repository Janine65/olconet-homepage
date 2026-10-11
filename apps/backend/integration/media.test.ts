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
    assert.equal((await upload(source, { ...data, altText: '' })).status, 400);
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
});
