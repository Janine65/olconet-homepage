import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { record, reportId } from '../travel/travel.input';
import { galleryCategory } from './media.input';

export const mediaOrderBy = [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }] as const;

export function orderToken(items: { id: string; revision: number }[]) {
  return createHash('sha256').update(JSON.stringify(items.map(item => [item.id, item.revision]))).digest('hex');
}

export function moveInput(body: unknown) {
  const input = record(body, ['category', 'assetId', 'position', 'token']);
  const category = galleryCategory(input['category']);
  if (typeof input['assetId'] !== 'string') throw new BadRequestException('Eine Bild-ID ist erforderlich.');
  const assetId = reportId(input['assetId']).toLowerCase();
  if (typeof input['position'] !== 'number' || !Number.isSafeInteger(input['position']) ||
    input['position'] < 1 || input['position'] > 1000001) {
    throw new BadRequestException('Zielposition muss eine ganze Zahl zwischen 1 und 1000001 sein.');
  }
  if (typeof input['token'] !== 'string' || !/^[a-f0-9]{64}$/.test(input['token'])) {
    throw new BadRequestException('Bitte die aktuelle Kategorie-Reihenfolge laden.');
  }
  return { category, assetId, position: input['position'], token: input['token'] };
}
