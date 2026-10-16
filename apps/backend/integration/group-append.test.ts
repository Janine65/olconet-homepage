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

test('Bestehende Fotogruppen sicher erweitern', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const url = process.env['TEST_DATABASE_URL'];
  assert.ok(url && process.env['UPLOAD_DIR']);
  assert.equal(new URL(url).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = url;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app); await app.listen(0, '127.0.0.1');
  const db = app.get(PrismaService);
  await db.loginThrottle.deleteMany();
  const admin = await db.adminUser.create({ data: { email: 'group-append@example.com', displayName: 'Groups',
    passwordHash: await hashPassword('Group-append-test-password!') } });
  const base = await app.getUrl();
  const headers = { Origin: 'http://localhost:18432', 'Content-Type': 'application/json', 'X-Olconet-Request': '1' };
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers,
    body: JSON.stringify({ email: admin.email, password: 'Group-append-test-password!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string, auth = false) => fetch(base + path, { headers: auth ? { Cookie: cookie } : {} });
  const post = (path: string, body: object, auth = true, origin = headers.Origin) => fetch(base + path, { method: 'POST',
    headers: { ...headers, Origin: origin, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const assets: string[] = [];
  const synthetic: string[] = [];
  t.after(async () => {
    try {
      await db.mediaAsset.deleteMany({ where: { id: { in: synthetic } } });
      for (const id of assets) {
        let asset = await db.mediaAsset.findUnique({ where: { id } });
        if (!asset || asset.parentId) continue;
        if (asset.status === 'PUBLISHED') {
          assert.equal((await post(`/api/admin/media/${id}/unpublish`, { revision: asset.revision })).status, 201);
          asset = await db.mediaAsset.findUniqueOrThrow({ where: { id } });
        }
        assert.equal((await post(`/api/admin/media/${id}/delete`, { revision: asset.revision })).status, 201);
      }
      await db.adminUser.delete({ where: { id: admin.id } });
    } finally { await app.close(); }
  });
  const source = await sharp({ create: { width: 12, height: 6, channels: 3, background: 'green' } }).png().toBuffer();
  const metadata = { title: 'Gruppe', altText: 'Gemeinsames Foto', description: 'Beschreibung',
    titleEn: 'Group', altTextEn: 'Shared photo', descriptionEn: 'Description', sortOrder: 4 };
  const upload = async (category = 'SAMMY') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(source)], { type: 'image/png' }), 'foto.png');
    form.append('metadata', JSON.stringify({ ...metadata, category }));
    const response = await fetch(base + '/api/admin/media', { method: 'POST',
      headers: { Origin: headers.Origin, 'X-Olconet-Request': '1', Cookie: cookie }, body: form });
    assert.equal(response.status, 201);
    const id = (await response.json()).id;
    assets.push(id);
    return id as string;
  };
  const group = async (category = 'SAMMY') => {
    const ids = [await upload(category), await upload(category)];
    assert.equal((await post('/api/admin/media/group', { ids })).status, 201);
    return ids[0]!;
  };
  const current = (id: string) => db.mediaAsset.findUniqueOrThrow({ where: { id },
    include: { children: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } });
  const id = await group();
  let root = await current(id);
  assert.equal((await post(`/api/admin/media/${id}/save`, {
    ...metadata, title: 'Hund am See', titleEn: 'Dog by the lake', description: 'Aktuell', descriptionEn: 'Current',
    category: 'SAMMY', revision: root.revision,
  })).status, 201);
  root = await current(id);
  assert.equal((await post(`/api/admin/media/${id}/publish`, { revision: root.revision })).status, 201);
  root = await current(id);

  await t.test('Anhaengen verlangt Sitzung, Ursprung und eine echte Fotogruppe', async () => {
    const photo = await upload();
    const body = { ids: [photo], revision: root.revision };
    assert.equal((await post(`/api/admin/media/${id}/photos`, body, false)).status, 401);
    assert.equal((await post(`/api/admin/media/${id}/photos`, body, true, 'https://foreign.example')).status, 403);
    assert.equal((await post(`/api/admin/media/${randomUUID()}/photos`, body)).status, 404);
    assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: [id], revision: root.revision })).status, 400);
    for (const target of [root.children[0]!.id, photo, await upload('TRAVEL')]) {
      assert.equal((await post(`/api/admin/media/${target}/photos`, { ids: [photo], revision: 0 })).status, 400);
    }
    assert.equal((await current(photo)).parentId, null);
  });
  await t.test('Neue Fotos erscheinen geordnet in derselben Gruppe, mit aktuellen zweisprachigen Angaben und Freigabe', async () => {
    const photos = [await upload(), await upload()];
    const before = await current(id);
    const count = await db.mediaAsset.count({ where: { parentId: null, category: 'SAMMY' } });
    assert.equal((await get(`/api/public/media/${photos[0]}/image`)).status, 404);
    const response = await post(`/api/admin/media/${id}/photos`, { ids: photos, revision: before.revision });
    assert.equal(response.status, 201);
    root = await current(id);
    assert.equal(root.revision, before.revision + 1);
    assert.equal(root.sortOrder, before.sortOrder);
    assert.deepEqual(root.publishedAt, before.publishedAt);
    assert.deepEqual(root.children.map(photo => photo.id), [...before.children.map(photo => photo.id), ...photos]);
    assert.equal(await db.mediaAsset.count({ where: { parentId: null, category: 'SAMMY' } }), count - 2);
    for (const photoId of photos) {
      const photo = await current(photoId);
      for (const key of ['title', 'altText', 'description', 'titleEn', 'altTextEn', 'descriptionEn', 'status', 'category'] as const) {
        assert.equal(photo[key], root[key]);
      }
      assert.deepEqual(photo.publishedAt, root.publishedAt);
      assert.equal((await get(`/api/public/media/${photoId}/image`)).status, 200);
    }
    const publicList = await (await get('/api/public/media?category=SAMMY&lang=en')).json();
    const published = publicList.items.find((item: { id: string }) => item.id === id);
    assert.equal(published.title, 'Dog by the lake');
    assert.deepEqual(published.children.map((photo: { id: string }) => photo.id), root.children.map(photo => photo.id));
    assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: photos, revision: before.revision })).status, 201);
    assert.equal((await current(id)).revision, root.revision);
    const fresh = await upload();
    assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: [fresh], revision: before.revision })).status, 409);
    assert.equal((await current(fresh)).parentId, null);
  });
  await t.test('Ungueltige Fotos rollen die gesamte Erweiterung zurueck', async () => {
    const valid = await upload();
    const wrongCategory = await upload('DRAWING');
    const modified = await upload();
    assert.equal((await post(`/api/admin/media/${modified}/save`, { ...metadata, category: 'SAMMY', revision: 0 })).status, 201);
    const published = await upload();
    assert.equal((await post(`/api/admin/media/${published}/publish`, { revision: 0 })).status, 201);
    const otherGroup = await group();
    for (const invalid of [wrongCategory, modified, published, otherGroup, (await current(otherGroup)).children[0]!.id]) {
      assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: [valid, invalid], revision: root.revision })).status, 409);
      assert.equal((await current(valid)).parentId, null);
      assert.equal((await current(id)).revision, root.revision);
    }
    assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: [valid, randomUUID()], revision: root.revision })).status, 404);
    assert.equal((await current(valid)).parentId, null);
  });
  await t.test('Gleichzeitige Erweiterungen lassen nur eine aktuelle Revision gewinnen', async () => {
    const photos = [await upload(), await upload()];
    const responses = await Promise.all(photos.map(photoId =>
      post(`/api/admin/media/${id}/photos`, { ids: [photoId], revision: root.revision })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const loser = photos[responses.findIndex(response => response.status === 409)]!;
    root = await current(id);
    assert.equal((await current(loser)).parentId, null);
    assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: [loser], revision: root.revision })).status, 201);
    root = await current(id);
  });
  await t.test('Ruecknahme und Erweiterung koennen keinen abweichenden Foto-Status erzeugen', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const photo = await upload();
      if (root.status === 'DRAFT') {
        assert.equal((await post(`/api/admin/media/${id}/publish`, { revision: root.revision })).status, 201);
        root = await current(id);
      }
      const results = await Promise.all([
        post(`/api/admin/media/${id}/photos`, { ids: [photo], revision: root.revision }),
        post(`/api/admin/media/${id}/unpublish`, { revision: root.revision }),
      ]);
      assert.deepEqual(results.map(response => response.status).sort(), [201, 409],
        JSON.stringify(await Promise.all(results.map(response => response.clone().json()))));
      root = await current(id);
      if (results[0]!.status === 409) {
        assert.equal((await post(`/api/admin/media/${id}/photos`, { ids: [photo], revision: root.revision })).status, 201);
        root = await current(id);
      }
      assert.equal((await current(photo)).status, root.status);
      for (const child of root.children) assert.equal(child.status, root.status);
    }
  });
  await t.test('Kreationen-Entwuerfe bleiben privat und die Grenze von genau 100 Fotos wird eingehalten', async () => {
    const draft = await group('DRAWING');
    for (let i = 0; i < 97; i++) synthetic.push(randomUUID());
    await db.mediaAsset.createMany({ data: synthetic.map((photoId, index) => ({
      ...metadata, id: photoId, parentId: draft, category: 'DRAWING', storageKey: `${photoId}.webp`, sortOrder: index + 1,
      originalName: 'boundary.png', mimeType: 'image/webp', byteSize: 1,
    })) });
    const last = await upload('DRAWING');
    const before = await current(draft);
    assert.equal(before.children.length + 1, 99);
    assert.equal((await post(`/api/admin/media/${draft}/photos`, { ids: [last], revision: before.revision })).status, 201);
    const full = await current(draft);
    assert.equal(full.children.length + 1, 100);
    assert.equal((await current(last)).status, 'DRAFT');
    assert.equal((await get(`/api/public/media/${last}/image`)).status, 404);
    const overflow = await upload('DRAWING');
    assert.equal((await post(`/api/admin/media/${draft}/photos`, { ids: [overflow], revision: full.revision })).status, 400);
    assert.equal((await current(draft)).children.length + 1, 100);
    assert.equal((await current(draft)).revision, full.revision);
    assert.equal((await current(overflow)).parentId, null);
    assert.equal((await post(`/api/admin/media/${draft}/photos`, { ids: [last], revision: before.revision })).status, 201);
  });
});
