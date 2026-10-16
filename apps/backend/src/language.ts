import { BadRequestException } from '@nestjs/common';

export type Language = 'de' | 'en';

export function language(value: unknown): Language {
  if (value === undefined || value === 'de') return 'de';
  if (value === 'en') return 'en';
  throw new BadRequestException('Sprache muss de oder en sein.');
}

export function translated(original: string, english: string, lang: Language) {
  return lang === 'en' && english.trim() ? english : original;
}

export function translatedMedia<T extends { title: string; titleEn: string; altText: string; altTextEn: string;
  description?: string | null; descriptionEn?: string }>(asset: T, lang: Language) {
  return { ...asset, title: translated(asset.title, asset.titleEn, lang), altText: translated(asset.altText, asset.altTextEn, lang),
    ...(asset.description !== undefined ? { description: translated(asset.description ?? '', asset.descriptionEn ?? '', lang) || null } : {}) };
}
