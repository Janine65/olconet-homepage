import assert from 'node:assert/strict';
import { test } from 'node:test';
import { language, translated, translatedMedia } from '../src/language';
import { hasContent, reportInput } from '../src/travel/travel.input';
import { mediaInput } from '../src/media/media.input';
import { rss } from '../src/travel/rss';

test('Sprachen werden explizit validiert, leere Uebersetzungen fallen feldweise auf Deutsch zurueck', () => {
  assert.equal(language(undefined), 'de');
  assert.equal(language('de'), 'de');
  assert.equal(language('en'), 'en');
  for (const value of ['', null, ['en'], 'EN', 'fr']) assert.throws(() => language(value));
  assert.equal(translated('Deutsch', 'English', 'de'), 'Deutsch');
  assert.equal(translated('Deutsch', 'English', 'en'), 'English');
  assert.equal(translated('Deutsch', '   ', 'en'), 'Deutsch');
  const asset = translatedMedia({ title: 'See', titleEn: 'Lake', altText: 'Blauer See', altTextEn: '',
    description: 'Beschreibung', descriptionEn: 'Description' }, 'en');
  assert.equal(asset.title, 'Lake');
  assert.equal(asset.altText, 'Blauer See');
  assert.equal(asset.description, 'Description');
  assert.equal(hasContent('<p><br></p><p>&nbsp; </p>'), false);
  assert.equal(hasContent('<p>Hello</p>'), true);
  assert.equal(hasContent('<figure><img data-asset-id="11111111-1111-4111-8111-111111111111"></figure>'), true);
});

test('Englische Eingaben sind optional, begrenzt und werden genau wie deutsche Inhalte bereinigt', () => {
  const metadata = { title: 'Reise', slug: 'reise', excerpt: 'Text', destination: '', travelStart: '', travelEnd: '' };
  const page = { contentHtml: '<p>Deutsch</p>', contentHtmlEn: '<p onclick="x">English<script>bad</script></p>',
    titleEn: 'Arrival', galleryImages: [] };
  const result = reportInput({ ...metadata, titleEn: 'Trip', pages: [page] });
  assert.equal(result.data.titleEn, 'Trip');
  assert.equal(result.pages[0]!.contentHtmlEn, '<p>English</p>');
  for (const patch of [{ titleEn: null }, { titleEn: 'x'.repeat(201) }, { excerptEn: 'x'.repeat(1001) }, { destinationEn: 1 }]) {
    assert.throws(() => reportInput({ ...metadata, ...patch, pages: [page] }));
  }
  for (const contentHtmlEn of [null, 1, 'x'.repeat(100001)]) {
    assert.throws(() => reportInput({ ...metadata, pages: [{ ...page, contentHtmlEn }] }));
  }
  assert.throws(() => reportInput({ ...metadata, pages: [0, 1].map(() => ({ contentHtml: '', contentHtmlEn: 'x'.repeat(50001) })) }));
  const media = { category: 'SAMMY', title: 'Hund', altText: 'Hund', description: '', sortOrder: 0 };
  assert.equal(mediaInput(media).data.titleEn, undefined);
  assert.equal(mediaInput({ ...media, titleEn: ' Dog ', altTextEn: '', descriptionEn: '' }).data.titleEn, 'Dog');
  for (const patch of [{ titleEn: null }, { titleEn: 'x'.repeat(201) }, { altTextEn: 'x'.repeat(501) }, { descriptionEn: 'x'.repeat(2001) }]) {
    assert.throws(() => mediaInput({ ...media, ...patch }));
  }
});

test('Englischer RSS-Feed verwendet englische Links und Sprachangaben ohne deutsche URLs zu veraendern', () => {
  const items = [{ id: 'abc', slug: 'reise', title: 'Trip & lake', excerpt: 'A & B', publishedAt: null }];
  const english = rss(items, 'https://example.com', 'en');
  assert.match(english, /<language>en<\/language>/);
  assert.match(english, /\/en\/reisen\/bericht\/\?slug=reise/);
  assert.match(english, /\/api\/public\/reports\/rss\?lang=en/);
  assert.match(english, /Trip &amp; lake/);
  assert.doesNotMatch(rss(items, 'https://example.com'), /\/en\//);
});
