import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import type { Prisma } from '../src/generated/prisma/client';
import { configureHttp } from '../src/http';
import { PrismaService } from '../src/prisma.service';

test('Startseitenbilder folgen dem Upload-Datum statt der Galerie- oder Berichtsreihenfolge', async t => {
  assert.equal(process.env['OLCONET_ISOLATED_TEST'], '1');
  const url = process.env['TEST_DATABASE_URL'];
  assert.ok(url && process.env['UPLOAD_DIR']);
  assert.equal(new URL(url).pathname, '/olconet_test');
  process.env['DATABASE_URL'] = url;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  const db = app.get(PrismaService);
  const assetIds: string[] = [];
  let authorId: string | undefined;
  t.after(async () => {
    try {
      if (authorId) {
        await db.travelReport.deleteMany({ where: { authorId } });
        await db.mediaAsset.deleteMany({ where: { id: { in: assetIds } } });
        await db.adminUser.delete({ where: { id: authorId } });
      }
    } finally { await app.close(); }
  });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const preview = async (category: string, lang = 'de') => {
    const response = await fetch(`${base}/api/public/media/latest?category=${category}&lang=${lang}`);
    assert.equal(response.status, 200);
    return await response.json();
  };

  const author = await db.adminUser.create({ data: {
    email: 'home-previews@example.com', displayName: 'Preview test', passwordHash: 'unused',
  } });
  authorId = author.id;
  const photo = async (day: number, data: Partial<Prisma.MediaAssetUncheckedCreateInput>) => {
    const id = randomUUID();
    assetIds.push(id);
    return db.mediaAsset.create({ data: {
      id, title: '', altText: 'Foto', storageKey: `${id}.webp`, originalName: 'foto.png', mimeType: 'image/webp',
      byteSize: 1, category: 'DRAWING', status: 'PUBLISHED', createdAt: new Date(Date.UTC(2024, 0, day)), ...data,
    } });
  };

  assert.deepEqual(await preview('DRAWING'), { image: null });
  const cover = await photo(1, { sortOrder: 0 });
  const groupPhoto = await photo(2, { parentId: cover.id, sortOrder: 1, altTextEn: 'Group photo' });
  const sammyPhoto = await photo(3, { category: 'SAMMY' });
  await photo(4, { status: 'DRAFT' });
  const gallery = await (await fetch(`${base}/api/public/media?category=DRAWING`)).json();
  assert.equal(gallery.items[0].id, cover.id);
  assert.deepEqual(await preview('DRAWING', 'en'), { image: { url: `/api/public/media/${groupPhoto.id}/image`, altText: 'Group photo' } });
  assert.deepEqual(await preview('SAMMY'), { image: { url: `/api/public/media/${sammyPhoto.id}/image`, altText: 'Foto' } });

  const olderReportPhoto = await photo(2, { category: 'TRAVEL', status: 'DRAFT' });
  const newerReportPhoto = await photo(1, { category: 'TRAVEL', status: 'DRAFT' });
  const privatePhoto = await photo(3, { category: 'TRAVEL', status: 'DRAFT' });
  for (const [index, [slug, image, pageStatus]] of ([
    ['preview-older-report', olderReportPhoto, 'PUBLISHED'],
    ['preview-newer-report', newerReportPhoto, 'PUBLISHED'],
    ['preview-private-page', privatePhoto, 'DRAFT'],
  ] as const).entries()) {
    const report = await db.travelReport.create({ data: {
      authorId: author.id, slug, title: slug, excerpt: '', status: 'PUBLISHED', publishedAt: new Date(Date.UTC(2024, 1, index + 1)),
    } });
    const page = await db.reportPage.create({ data: { reportId: report.id, status: pageStatus, sortOrder: 0 } });
    await db.reportImage.create({ data: { reportId: report.id, pageId: page.id, assetId: image.id } });
  }
  assert.deepEqual(await preview('TRAVEL'), {
    image: { url: `/api/public/reports/preview-older-report/images/${olderReportPhoto.id}`, altText: 'Foto' },
  });
});
