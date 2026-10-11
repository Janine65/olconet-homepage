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

export function mediaInput(body: unknown, updating = false) {
  const input = record(body, ['category', 'title', 'altText', 'description', 'sortOrder', ...(updating ? ['revision'] : ['uploadKey'])]);
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
    },
    revision: updating ? reportVersion(input['revision']) : 0,
    uploadKey: input['uploadKey'] === undefined ? null : reportId(String(input['uploadKey'])),
  };
}
