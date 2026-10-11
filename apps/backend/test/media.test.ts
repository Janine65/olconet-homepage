import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { normalizeImage, MAX_UPLOAD_BYTES } from '../src/media/image';
import { mediaInput, galleryCategory } from '../src/media/media.input';

test('Bilddaten verlangen Kategorie, Titel, Alternativtext und begrenzte Sortierung', () => {
  const input = { category: 'SAMMY', title: ' Sammy ', altText: ' Hund am See ', description: '', sortOrder: 0 };
  assert.equal(mediaInput(input).data.title, 'Sammy');
  assert.equal(mediaInput(input).data.description, null);
  for (const invalid of [
    { ...input, category: 'INVALID' }, { ...input, altText: ' ' }, { ...input, title: 'x'.repeat(201) },
    { ...input, sortOrder: 0.5 }, { ...input, sortOrder: -1 }, { ...input, sortOrder: 1000001 },
    { ...input, status: 'PUBLISHED' },
  ]) assert.throws(() => mediaInput(invalid));
  assert.throws(() => mediaInput(input, true));
  assert.equal(mediaInput({ ...input, revision: 2 }, true).revision, 2);
  assert.throws(() => galleryCategory(['SAMMY']));
});

test('Bilder werden orientiert, begrenzt und ohne EXIF neu kodiert', async () => {
  const source = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: 'green' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeImage(source);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 2560);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.icc, undefined);
});

test('Echte PNG/JPEG/WebP sind erlaubt, SVG, GIF und defekte Dateien nicht', async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const source = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).toFormat(format).toBuffer();
    assert.equal((await sharp(await normalizeImage(source)).metadata()).format, 'webp');
  }
  for (const source of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),
    Buffer.from('not an image'),
    Buffer.alloc(0),
    Buffer.alloc(MAX_UPLOAD_BYTES + 1),
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).gif().toBuffer(),
    await sharp({ create: { width: 6400, height: 6400, channels: 3, background: 'white' } }).png().toBuffer(),
  ]) await assert.rejects(normalizeImage(source));
});
