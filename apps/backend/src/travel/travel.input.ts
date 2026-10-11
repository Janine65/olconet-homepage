import { BadRequestException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function cleanContent(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h2', 'h3', 'strong', 'em', 's', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr', 'figure', 'figcaption', 'img'],
    allowedAttributes: { img: ['data-asset-id'] },
    exclusiveFilter: (frame) => frame.tag === 'img' && !uuid.test(frame.attribs['data-asset-id'] ?? ''),
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'svg', 'math'],
  });
}

export function inlineImageIds(html: string) {
  const ids = new Set<string>();
  sanitizeHtml(cleanContent(html), {
    transformTags: { img: (tagName, attribs): sanitizeHtml.Tag => {
      ids.add(attribs['data-asset-id']!.toLowerCase());
      return { tagName, attribs };
    } },
  });
  return [...ids];
}

export function publicContent(html: string, slug: string, assets: { id: string; altText: string }[]) {
  const allowed = new Map(assets.map(asset => [asset.id, asset]));
  return sanitizeHtml(cleanContent(html), {
    allowedTags: ['p', 'h2', 'h3', 'strong', 'em', 's', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr', 'figure', 'figcaption', 'img'],
    allowedAttributes: { img: ['src', 'alt', 'loading'] },
    transformTags: { img: (tagName, attribs): sanitizeHtml.Tag => {
      const asset = allowed.get((attribs['data-asset-id'] ?? '').toLowerCase());
      return { tagName, attribs: asset ? {
        src: `/api/public/reports/${encodeURIComponent(slug)}/images/${asset.id}`, alt: asset.altText, loading: 'lazy',
      } : {} };
    } },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs['src'],
  });
}

export function record(body: unknown, keys: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))) {
    throw new BadRequestException('Ungueltige Berichtsdaten oder unbekannte Felder.');
  }
  return Object.fromEntries(Object.entries(body));
}

function text(value: unknown, name: string, maximum: number, required = true): string {
  if (typeof value !== 'string' || value.trim().length > maximum || (required && !value.trim())) {
    throw new BadRequestException(`${name}: ${required ? '1' : '0'} bis ${maximum} Zeichen erforderlich.`);
  }
  return value.trim();
}

function date(value: unknown, name: string): Date | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} muss ein Datum im Format YYYY-MM-DD sein.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} ist kein gueltiges Datum.`);
  }
  return parsed;
}

export function reportVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException('Eine gueltige Berichtsversion ist erforderlich.');
  }
  return value;
}

export function reportInput(body: unknown, updating = false) {
  const input = record(body, ['title', 'slug', 'excerpt', 'contentHtml', 'destination', 'travelStart', 'travelEnd',
    'galleryImages',
    ...(updating ? ['version'] : [])]);
  const title = text(input['title'], 'Titel', 200);
  const slug = text(input['slug'], 'URL-Kuerzel', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new BadRequestException('Das URL-Kuerzel darf nur Kleinbuchstaben, Zahlen und einzelne Bindestriche enthalten.');
  }
  const excerpt = text(input['excerpt'], 'Kurzbeschreibung', 1000, false);
  if (typeof input['contentHtml'] !== 'string' || Buffer.byteLength(input['contentHtml']) > 100000) {
    throw new BadRequestException('Berichtstext darf maximal 100000 UTF-8-Bytes enthalten.');
  }
  const contentHtml = cleanContent(input['contentHtml']);
  const gallery = input['galleryImages'] ?? [];
  if (!Array.isArray(gallery) || gallery.length > 100) throw new BadRequestException('Maximal 100 Galeriebilder pro Bericht erlaubt.');
  const galleryImages = gallery.map((item: unknown) => {
    const image = record(item, ['assetId', 'caption']);
    return { assetId: reportId(text(image['assetId'], 'Bild-ID', 36)).toLowerCase(),
      caption: text(image['caption'], 'Bildunterschrift', 500, false) };
  });
  if (new Set(galleryImages.map(image => image.assetId)).size !== galleryImages.length) {
    throw new BadRequestException('Ein Bild darf nur einmal in der Berichtsgalerie stehen.');
  }
  const imageIds = [...new Set([...inlineImageIds(contentHtml), ...galleryImages.map(image => image.assetId)])];
  if (imageIds.length > 100) throw new BadRequestException('Maximal 100 verschiedene Bilder pro Bericht erlaubt.');
  const destination = text(input['destination'], 'Reiseziel', 200, false) || null;
  const travelStart = date(input['travelStart'], 'Reisebeginn');
  const travelEnd = date(input['travelEnd'], 'Reiseende');
  if (travelStart && travelEnd && travelStart > travelEnd) {
    throw new BadRequestException('Das Reiseende darf nicht vor dem Reisebeginn liegen.');
  }
  return {
    data: { title, slug, excerpt, contentHtml, destination, travelStart, travelEnd },
    galleryImages, imageIds,
    version: updating ? reportVersion(input['version']) : 0,
  };
}

export function requirePublishable(data: { excerpt: string; contentHtml: string }) {
  const plainText = sanitizeHtml(data.contentHtml, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(?:nbsp|#160);/g, ' ').trim();
  if (!data.excerpt.trim() || !plainText) {
    throw new BadRequestException('Vor der Veroeffentlichung sind Kurzbeschreibung und Berichtstext erforderlich.');
  }
}

export function reportId(value: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new BadRequestException('Ungueltige Berichts-ID.');
  }
  return value;
}

export function pageNumber(value: unknown) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) {
    throw new BadRequestException('Ungueltige Seitennummer.');
  }
  return Number(value);
}
