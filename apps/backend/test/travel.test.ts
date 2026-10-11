import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanContent, inlineImageIds, publicContent, pageNumber, reportInput, reportVersion, requirePublishable } from '../src/travel/travel.input';
import { readSiteUrl, rss } from '../src/travel/rss';

const input = {
  title: 'Meine Reise', slug: 'meine-reise', excerpt: '', contentHtml: '<p></p>',
  destination: '', travelStart: '', travelEnd: '',
};

test('Entwuerfe duerfen leer sein, Veroeffentlichung benoetigt Text und Kurzbeschreibung', () => {
  const parsed = reportInput(input);
  assert.equal(parsed.data.destination, null);
  assert.equal(parsed.data.travelStart, null);
  assert.throws(() => requirePublishable(parsed.data));
  assert.throws(() => requirePublishable({ excerpt: 'Test', contentHtml: '<p>&nbsp; </p>' }));
  assert.doesNotThrow(() => requirePublishable({ excerpt: 'Test', contentHtml: '<p>Bericht</p>' }));
});

test('Visueller Inhalt erlaubt Formatierung, aber keine Skripte, Attribute oder eingebetteten Inhalte', () => {
  assert.equal(cleanContent('<p onclick="alert(1)">Hallo <strong>Welt</strong><script>alert(1)</script><img src="x" onerror="x"><a href="javascript:x">Link</a><iframe>bad</iframe></p>'),
    '<p>Hallo <strong>Welt</strong>Link</p>');
  assert.equal(cleanContent('<h2 style="color:red">Titel</h2><ul><li>Ort</li></ul>'),
    '<h2>Titel</h2><ul><li>Ort</li></ul>');
});

test('Berichtsdaten sind begrenzt und echte Kalenderdaten sowie Reihenfolge werden geprueft', () => {
  for (const patch of [
    { title: '' }, { title: 'a'.repeat(201) }, { slug: 'Bad_Slug' }, { slug: 'a--b' },
    { excerpt: 'a'.repeat(1001) }, { destination: 'a'.repeat(201) },
    { contentHtml: '\u00e4'.repeat(50001) }, { travelStart: '2026-02-30' },
    { travelStart: '2026-02-02', travelEnd: '2026-02-01' }, { authorId: 'spoof' },
  ]) assert.throws(() => reportInput({ ...input, ...patch }));
  assert.equal(reportInput({ ...input, travelStart: '2024-02-29', version: 1 }, true).version, 1);
  assert.throws(() => reportInput(input, true));
  for (const version of [null, -1, 1.5, '1']) assert.throws(() => reportVersion(version));
  assert.equal(pageNumber(undefined), 1);
  assert.equal(pageNumber('2'), 2);
  for (const page of ['0', '1.5', '-1', '1000000']) assert.throws(() => pageNumber(page));
});

test('RSS escaped XML, stabile GUIDs und konfigurierbare Homepage-Adresse', () => {
  const feed = rss([{
    id: 'abc', slug: 'reise', title: '<Test> & "Reise"', excerpt: 'A & B',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  }], 'https://olconet.com');
  assert.match(feed, /&lt;Test&gt; &amp; &quot;Reise&quot;/);
  assert.match(feed, /urn:olconet:travel:abc/);
  assert.match(feed, /https:\/\/olconet.com\/reisen\/bericht\/\?slug=reise/);
  assert.match(feed, /Thu, 01 Jan 2026 00:00:00 GMT/);
  assert.equal(readSiteUrl({}), 'http://localhost:18431');
  assert.throws(() => readSiteUrl({ NODE_ENV: 'production' }));
  for (const site of ['file:///tmp', 'https://example.com/', 'https://user:pw@example.com']) {
    assert.throws(() => readSiteUrl({ SITE_URL: site }));
  }
});

test('Berichtsbilder erlauben nur validierte IDs, nie fremde URLs oder vom Client gesetzte Alternativtexte', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const html = `<figure onclick="bad"><img data-asset-id="${id}" src="https://foreign.example/secret" alt="spoof" onerror="bad"><figcaption>Am &lt;See&gt;</figcaption></figure>`;
  assert.equal(cleanContent(html), `<figure><img data-asset-id="${id}" /><figcaption>Am &lt;See&gt;</figcaption></figure>`);
  assert.deepEqual(inlineImageIds(html + html), [id]);
  const published = publicContent(html, 'see', [{ id, altText: 'See & Berge' }]);
  assert.match(published, new RegExp(`/api/public/reports/see/images/${id}`));
  assert.match(published, /alt="See &amp; Berge"/);
  assert.doesNotMatch(published, /foreign|spoof|onerror|data-asset-id/);
  assert.doesNotMatch(publicContent(html, 'see', []), /<img/);
  assert.deepEqual(inlineImageIds('<img data-asset-id="../../secret"><img src="/api/admin/media/x/image">'), []);
  const parsed = reportInput({ ...input, contentHtml: html, galleryImages: [{ assetId: id, caption: 'See' }] });
  assert.deepEqual(parsed.imageIds, [id]);
  assert.equal(parsed.galleryImages[0]!.caption, 'See');
  assert.throws(() => reportInput({ ...input, galleryImages: [{ assetId: id, caption: '' }, { assetId: id, caption: '' }] }));
  assert.throws(() => reportInput({ ...input, galleryImages: Array.from({ length: 101 }, () => ({ assetId: id, caption: '' })) }));
  assert.throws(() => reportInput({ ...input, galleryImages: [{ assetId: id, caption: 'x'.repeat(501) }] }));
});
