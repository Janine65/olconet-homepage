import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/auth/password';

interface OrderPage { items: { id: string; title: string; position: number }[]; total: number; token: string; }

test('Kategorie-Reihenfolge mit mehr als einer Bildseite', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const url = process.env['TEST_DATABASE_URL'];
  assert.ok(url && process.env['UPLOAD_DIR']);
  assert.equal(new URL(url).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = url;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureHttp(app); await app.listen(0, '127.0.0.1');
  const db = app.get(PrismaService);
  t.after(async () => {
    await db.mediaAsset.deleteMany({ where: { storageKey: { startsWith: 'order-fixture-' } } });
    await db.adminUser.delete({ where: { email: 'order@example.com' } });
    await app.close();
  });
  await db.loginThrottle.deleteMany();
  const user = await db.adminUser.create({ data: { email: 'order@example.com', displayName: 'Order',
    passwordHash: await hashPassword('Order-test-password!') } });
  const base = await app.getUrl();
  const headers = { Origin: 'http://localhost:18432', 'X-Olconet-Request': '1', 'Content-Type': 'application/json' };
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ email: user.email, password: 'Order-test-password!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string, auth = true) => fetch(`${base}${path}`, { headers: auth ? { Cookie: cookie } : {} });
  const post = (body: object, origin = headers.Origin, auth = true) => fetch(`${base}/api/admin/media/order/move`, {
    method: 'POST', headers: { ...headers, Origin: origin, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  const order = async (page = 1): Promise<OrderPage> => (await get(`/api/admin/media/order?category=SAMMY&page=${page}`)).json();
  const prefix = 'order-fixture-';
  await db.mediaAsset.createMany({ data: Array.from({ length: 25 }, (_, index) => ({
    category: 'SAMMY', title: `Bild ${index + 1}`, altText: `Bild ${index + 1}`, originalName: 'fixture',
    storageKey: `${prefix}${index}`, mimeType: 'image/webp', byteSize: 1, sortOrder: 0,
    createdAt: new Date(Date.UTC(2026, 0, 25 - index)), status: index === 5 ? 'DRAFT' : 'PUBLISHED',
  })) });
  const drawing = await db.mediaAsset.create({ data: {
    category: 'DRAWING', title: 'Zeichnung', altText: 'Zeichnung', originalName: 'fixture',
    storageKey: `${prefix}drawing`, mimeType: 'image/webp', byteSize: 1, sortOrder: 50,
  } });
  await t.test('Auth, CSRF, Kategorie und Positionsgrenzen werden durchgesetzt', async () => {
    assert.equal((await get('/api/admin/media/order?category=SAMMY', false)).status, 401);
    assert.equal((await get('/api/admin/media/order?category=TRAVEL')).status, 400);
    assert.equal((await get('/api/admin/media/order?category=SAMMY&page=0')).status, 400);
    const snapshot = await order();
    const move = { category: 'SAMMY', assetId: snapshot.items[0].id, position: 25, token: snapshot.token };
    assert.equal((await post(move, headers.Origin, false)).status, 401);
    assert.equal((await post(move, 'https://foreign.example')).status, 403);
    assert.equal((await post({ ...move, position: 26 })).status, 400);
    assert.equal((await post({ ...move, assetId: drawing.id })).status, 404);
    assert.equal((await post({ ...move, token: '0'.repeat(64) })).status, 409);
  });
  await t.test('Verschieben über Seiten normalisiert gleiche Sortierwerte und ändert nur diese Kategorie', async () => {
    const before = await order();
    assert.equal(before.total, 25); assert.equal(before.items.length, 20);
    assert.equal(before.items[0].title, 'Bild 1');
    assert.equal((await order(2)).items[0].position, 21);
    assert.equal((await post({ category: 'SAMMY', assetId: before.items[0].id, position: 25, token: before.token })).status, 201);
    const after = await order(2);
    assert.equal(after.items[4].id, before.items[0].id);
    const rows = await db.mediaAsset.findMany({ where: { category: 'SAMMY' }, orderBy: { sortOrder: 'asc' } });
    assert.deepEqual(rows.map(row => row.sortOrder), Array.from({ length: 25 }, (_, i) => i));
    assert.deepEqual(await db.mediaAsset.findUnique({ where: { id: drawing.id } }), drawing);
    assert.equal((await post({ category: 'SAMMY', assetId: before.items[1].id, position: 1, token: before.token })).status, 409);
    const publicFirst = await (await get('/api/public/media?category=SAMMY', false)).json();
    assert.equal(publicFirst.items[0].title, 'Bild 2');
    assert.equal(publicFirst.total, 24);
    assert.equal(publicFirst.items.some((item: { title: string }) => item.title === 'Bild 6'), false);
  });
  await t.test('Nachbarn über die Seitengrenze verschieben; veraltete Metadaten können Sortierung nicht überschreiben', async () => {
    const snapshot = await order(2);
    const id = snapshot.items[0].id;
    const old = await db.mediaAsset.findUniqueOrThrow({ where: { id } });
    assert.equal((await post({ category: 'SAMMY', assetId: id, position: 20, token: snapshot.token })).status, 201);
    assert.equal((await order()).items[19].id, id);
    const stale = await fetch(`${base}/api/admin/media/${id}/save`, { method: 'POST', headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ category: 'SAMMY', title: old.title, altText: old.altText, description: '', sortOrder: old.sortOrder, revision: old.revision }) });
    assert.equal(stale.status, 409);
  });
  await t.test('Gleichzeitige Verschiebungen derselben Kategorie: genau eine gewinnt', async () => {
    const snapshot = await order();
    const responses = await Promise.all([
      post({ category: 'SAMMY', assetId: snapshot.items[0].id, position: 3, token: snapshot.token }),
      post({ category: 'SAMMY', assetId: snapshot.items[1].id, position: 4, token: snapshot.token }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  });
  await t.test('Neue Bilder, Löschen und Kategorie-Wechsel machen alte Reihenfolge-Tokens ungültig', async () => {
    const snapshot = await order();
    const added = await db.mediaAsset.create({ data: {
      category: 'SAMMY', title: 'Neu', altText: 'Neu', originalName: 'fixture',
      storageKey: `${prefix}new`, mimeType: 'image/webp', byteSize: 1,
    } });
    assert.equal((await post({ category: 'SAMMY', assetId: snapshot.items[0].id, position: 2, token: snapshot.token })).status, 409);
    const withNew = await order();
    await db.mediaAsset.delete({ where: { id: added.id } });
    assert.equal((await post({ category: 'SAMMY', assetId: snapshot.items[0].id, position: 2, token: withNew.token })).status, 409);
    await db.mediaAsset.update({ where: { id: drawing.id }, data: { category: 'SAMMY', revision: { increment: 1 } } });
    assert.equal((await post({ category: 'SAMMY', assetId: snapshot.items[0].id, position: 2, token: snapshot.token })).status, 409);
  });
  await t.test('Gleiche Position ist ein No-op und verändert keine Revisionen', async () => {
    const snapshot = await order();
    assert.equal((await post({ category: 'SAMMY', assetId: snapshot.items[0].id, position: 1, token: snapshot.token })).status, 201);
    assert.equal((await order()).token, snapshot.token);
  });
  for (const category of ['DRAWING', 'SAMMY'] as const) {
    await t.test(`${category}: neue Veröffentlichungen vorne, manuelle Reihenfolge und Gruppenfotos bleiben erhalten`, async () => {
      const gallery = async () => {
        const first = await (await get(`/api/public/media?category=${category}`, false)).json();
        const second = await (await get(`/api/public/media?category=${category}&page=2`, false)).json();
        return [...first.items, ...second.items] as { id: string; children: { id: string }[] }[];
      };
      const previous = await gallery();
      const fixture = (suffix: string, sortOrder: number) => ({
        category, title: suffix, altText: suffix, originalName: 'fixture',
        storageKey: `${prefix}${category}-${suffix}`, mimeType: 'image/webp', byteSize: 1,
        sortOrder, createdAt: new Date('2020-01-01'),
      });
      const single = await db.mediaAsset.create({ data: fixture('single', 900) });
      const publish = async (id: string) => {
        const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id } });
        return fetch(`${base}/api/admin/media/${id}/publish`, {
          method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ revision: asset.revision }),
        });
      };
      assert.equal((await publish(single.id)).status, 201);
      assert.deepEqual((await gallery()).map(item => item.id), [single.id, ...previous.map(item => item.id)]);
      const group = await db.mediaAsset.create({ data: fixture('group', 800) });
      const last = await db.mediaAsset.create({ data: { ...fixture('last', 2), parentId: group.id } });
      const first = await db.mediaAsset.create({ data: { ...fixture('first', 1), parentId: group.id } });
      assert.equal((await publish(group.id)).status, 201);
      const after = await gallery();
      assert.deepEqual(after.map(item => item.id), [group.id, single.id, ...previous.map(item => item.id)]);
      assert.deepEqual(after[0].children.map(item => item.id), [first.id, last.id]);
      const snapshot: OrderPage = await (await get(`/api/admin/media/order?category=${category}`)).json();
      assert.equal((await post({ category, assetId: single.id, position: 1, token: snapshot.token })).status, 201);
      assert.deepEqual((await gallery()).slice(0, 2).map(item => item.id), [single.id, group.id]);
      assert.equal((await publish(group.id)).status, 201);
      assert.deepEqual((await gallery()).slice(0, 2).map(item => item.id), [single.id, group.id]);
      const visible = await db.mediaAsset.findUniqueOrThrow({ where: { id: group.id } });
      const unpublish = await fetch(`${base}/api/admin/media/${group.id}/unpublish`, {
        method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ revision: visible.revision }),
      });
      assert.equal(unpublish.status, 201);
      assert.equal((await gallery()).some(item => item.id === group.id), false);
      assert.equal((await publish(group.id)).status, 201);
      assert.deepEqual((await gallery()).slice(0, 2).map(item => item.id), [group.id, single.id]);
      assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: first.id } })).sortOrder, 1);
      assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: last.id } })).sortOrder, 2);
    });
  }
  await t.test('Veröffentlichte Kategorie-Wechsel werden in der Zielgalerie vorne eingefügt', async () => {
    const asset = await db.mediaAsset.findFirstOrThrow({ where: { category: 'DRAWING', parentId: null, status: 'PUBLISHED' } });
    const response = await fetch(`${base}/api/admin/media/${asset.id}/save`, {
      method: 'POST', headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ category: 'SAMMY', title: asset.title, altText: asset.altText,
        description: '', sortOrder: 900, revision: asset.revision }),
    });
    assert.equal(response.status, 201);
    const gallery = await (await get('/api/public/media?category=SAMMY', false)).json();
    assert.equal(gallery.items[0].id, asset.id);
  });
});
