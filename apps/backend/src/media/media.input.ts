import { BadRequestException } from '@nestjs/common';
import { record, reportId, reportVersion } from '../travel/travel.input';

export function galleryCategory(value: unknown): 'DRAWING' | 'SAMMY' {
  if (value !== 'DRAWING' && value !== 'SAMMY') {
    throw new BadRequestException('Kategorie muss DRAWING oder SAMMY sein.');
  }
  return value;
}

export function mediaCategory(value: unknown): 'DRAWING' | 'SAMMY' | 'TRAVEL' {
  return value === 'TRAVEL' ? value : galleryCategory(value);
}

export function photoGroupInput(body: unknown) {
  const input = record(body, ['ids']);
  if (!Array.isArray(input['ids']) || input['ids'].length < 2 || input['ids'].length > 100) {
    throw new BadRequestException('Eine Fotogruppe muss 2 bis 100 Bilder enthalten.');
  }
  const ids = input['ids'].map((id: unknown) => {
    if (typeof id !== 'string') throw new BadRequestException('Ungueltige Bild-ID.');
    return reportId(id).toLowerCase();
  });
  if (new Set(ids).size !== ids.length) throw new BadRequestException('Jedes Bild darf nur einmal zur Gruppe gehoeren.');
  return ids;
}

export function mediaInput(body: unknown, updating = false) {
  const input = record(body, ['category', 'title', 'altText', 'description', 'titleEn', 'altTextEn', 'descriptionEn',
    'sortOrder', ...(updating ? ['revision'] : ['uploadKey'])]);
  const text = (key: string, maximum: number, required: boolean) => {
    const value = input[key];
    if (typeof value !== 'string' || value.trim().length > maximum || (required && !value.trim())) {
      throw new BadRequestException(`${key}: ${required ? 1 : 0} bis ${maximum} Zeichen erforderlich.`);
    }
    return value.trim();
  };
  const sortOrder = input['sortOrder'];
  if (typeof sortOrder !== 'number' || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000000) {
    throw new BadRequestException('Sortierung muss eine ganze Zahl zwischen 0 und 1000000 sein.');
  }
  return {
    data: {
      category: mediaCategory(input['category']), title: text('title', 200, true),
      altText: text('altText', 500, true), description: text('description', 2000, false) || null, sortOrder,
      ...(input['titleEn'] !== undefined ? { titleEn: text('titleEn', 200, false) } : {}),
      ...(input['altTextEn'] !== undefined ? { altTextEn: text('altTextEn', 500, false) } : {}),
      ...(input['descriptionEn'] !== undefined ? { descriptionEn: text('descriptionEn', 2000, false) } : {}),
    },
    revision: updating ? reportVersion(input['revision']) : 0,
    uploadKey: input['uploadKey'] === undefined ? null : reportId(String(input['uploadKey'])),
  };
}
