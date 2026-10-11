import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type {} from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma.service';
import { galleryCategory, mediaCategory, mediaInput } from './media.input';
import { Prisma } from '../generated/prisma/client';
import { lockMedia } from './media.lock';
import { normalizeImage } from './image';
import { mediaOrderBy, moveInput, orderToken } from './media.order';

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  readonly directory = resolve(process.env['UPLOAD_DIR'] || 'uploads');
  private processing = 0;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleInit() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }

  private path(key: string) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(key)) throw new Error('Ungueltiger gespeicherter Bildschluessel.');
    return resolve(this.directory, key);
  }

  async list(page: number, category?: unknown, publicOnly = false) {
    const where = {
      ...(category === undefined ? (publicOnly ? { category: { in: ['DRAWING', 'SAMMY'] as ('DRAWING' | 'SAMMY')[] } } : {}) :
        { category: publicOnly ? galleryCategory(category) : mediaCategory(category) }),
      ...(publicOnly ? { status: 'PUBLISHED' as const } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where, orderBy: [...mediaOrderBy], skip: (page - 1) * 20, take: 20,
        select: { id: true, title: true, altText: true, description: true, category: true, sortOrder: true,
          status: true, revision: true, publishedAt: true },
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);
    return { items, total, page, pageSize: 20 };
  }

  async order(categoryInput: unknown, page: number) {
    const category = galleryCategory(categoryInput);
    return this.prisma.$transaction(async db => {
      const ordered = await db.mediaAsset.findMany({
        where: { category }, orderBy: [...mediaOrderBy], select: { id: true, revision: true },
      });
      const ids = ordered.slice((page - 1) * 20, page * 20).map(item => item.id);
      const assets = await db.mediaAsset.findMany({
        where: { id: { in: ids } }, select: { id: true, title: true, altText: true, status: true },
      });
      const byId = new Map(assets.map(asset => [asset.id, asset]));
      return { items: ids.map((id, index) => ({ ...byId.get(id)!, position: (page - 1) * 20 + index + 1 })),
        total: ordered.length, page, pageSize: 20, category, token: orderToken(ordered) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async get(id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, title: true, altText: true, description: true, category: true, sortOrder: true,
        status: true, revision: true, publishedAt: true },
    });
    if (!asset) throw new NotFoundException('Das Bild wurde nicht gefunden.');
    return asset;
  }

  async move(body: unknown) {
    const input = moveInput(body);
    try {
      return await this.prisma.$transaction(async db => {
        const ordered = await db.mediaAsset.findMany({
          where: { category: input.category }, orderBy: [...mediaOrderBy],
          select: { id: true, revision: true, sortOrder: true },
        });
        if (orderToken(ordered) !== input.token) {
          throw new ConflictException('Die Kategorie wurde zwischenzeitlich geaendert. Bitte die Reihenfolge neu laden.');
        }
        const index = ordered.findIndex(item => item.id === input.assetId);
        if (index < 0) throw new NotFoundException('Das Bild ist nicht in dieser Kategorie.');
        if (input.position > ordered.length) throw new BadRequestException('Die Zielposition liegt ausserhalb der Kategorie.');
        if (ordered.length > 1000001) throw new BadRequestException('Die Kategorie ist fuer die automatische Sortierung zu gross.');
        if (index !== input.position - 1) {
          await lockMedia(db, this.prisma.databaseSchema, ordered.map(item => item.id));
          const [asset] = ordered.splice(index, 1);
          ordered.splice(input.position - 1, 0, asset!);
          const changed = ordered.map((item, position) => ({ ...item, position }))
            .filter(item => item.sortOrder !== item.position);
          // Normalize ties to unique ranks; update revisions so older metadata forms cannot undo the move.
          for (let offset = 0; offset < changed.length; offset += 500) {
            const rows = changed.slice(offset, offset + 500);
            await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${this.prisma.databaseSchema.replace(/"/g, '""')}"."MediaAsset"`)} AS asset
              SET "sortOrder" = ranks.position, "revision" = asset."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
              FROM (VALUES ${Prisma.join(rows.map(item => Prisma.sql`(${item.id}::uuid, ${item.position}::integer)`))})
                AS ranks(id, position) WHERE asset."id" = ranks.id`);
          }
        }
        return { saved: true, position: input.position };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.['code']))))) {
        throw new ConflictException('Die Kategorie wurde gleichzeitig geaendert. Bitte die Reihenfolge neu laden.');
      }
      throw error;
    }
  }

  async upload(file: Express.Multer.File | undefined, body: unknown) {
    const input = mediaInput(body);
    if (!file) throw new BadRequestException('Bitte genau eine Bilddatei hochladen.');
    const uploadFingerprint = createHash('sha256').update(file.buffer).update(JSON.stringify(input.data)).digest('hex');
    const existingUpload = async () => {
      if (!input.uploadKey) return null;
      const existing = await this.prisma.mediaAsset.findUnique({ where: { uploadKey: input.uploadKey } });
      if (!existing) return null;
      if (existing.uploadFingerprint !== uploadFingerprint) throw new ConflictException('Dieser Upload-Schluessel wurde bereits fuer andere Bilddaten verwendet.');
      return { id: existing.id };
    };
    const existing = await existingUpload();
    if (existing) return existing;
    if (this.processing >= 2) throw new HttpException('Bildverarbeitung ausgelastet. Bitte erneut versuchen.', 429);
    this.processing++;
    try {
      const image = await normalizeImage(file.buffer);
      const storageKey = `${randomUUID()}.webp`;
      await writeFile(this.path(storageKey), image, { flag: 'wx', mode: 0o600 });
      try {
        return await this.prisma.mediaAsset.create({
          data: { ...input.data, uploadKey: input.uploadKey, uploadFingerprint, storageKey, originalName: file.originalname.slice(0, 255), mimeType: 'image/webp', byteSize: image.length },
          select: { id: true },
        });
      } catch (error) {
        try { await unlink(this.path(storageKey)); }
        catch (cleanupError) { this.logger.error('Verwaistes Upload konnte nicht entfernt werden.', cleanupError); }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const repeated = await existingUpload();
          if (repeated) return repeated;
        }
        throw error;
      }
    } finally { this.processing--; }
  }

  async save(id: string, body: unknown) {
    const { data, revision } = mediaInput(body, true);
    return this.prisma.$transaction(async db => {
      await lockMedia(db, this.prisma.databaseSchema, [id]);
      const current = await db.mediaAsset.findUnique({ where: { id }, include: { _count: { select: { reports: true } } } });
      if (!current) throw new NotFoundException('Das Bild wurde nicht gefunden.');
      if (current.revision !== revision) throw new ConflictException('Das Bild wurde zwischenzeitlich geaendert. Bitte neu laden.');
      if (current.category !== data.category && (current._count.reports || (current.status === 'PUBLISHED' && data.category === 'TRAVEL'))) {
        throw new ConflictException('Vor dem Kategorie-Wechsel Berichtszuordnungen entfernen und Veroeffentlichung zuruecknehmen.');
      }
      await db.mediaAsset.update({ where: { id }, data: { ...data, revision: { increment: 1 } } });
      return { saved: true };
    });
  }

  private async conflict(id: string): Promise<never> {
    if (!await this.prisma.mediaAsset.findUnique({ where: { id }, select: { id: true } })) {
      throw new NotFoundException('Das Bild wurde nicht gefunden.');
    }
    throw new ConflictException('Das Bild wurde zwischenzeitlich geaendert. Bitte die Liste neu laden.');
  }

  async status(id: string, revision: number, published: boolean) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id }, select: { category: true } });
    if (asset?.category === 'TRAVEL') throw new BadRequestException('Reisebilder werden ausschliesslich mit ihrem Reisebericht veroeffentlicht.');
    const result = await this.prisma.mediaAsset.updateMany({
      where: { id, revision, category: { in: ['DRAWING', 'SAMMY'] } },
      data: { status: published ? 'PUBLISHED' : 'DRAFT', publishedAt: published ? new Date() : null, revision: { increment: 1 } },
    });
    if (!result.count) await this.conflict(id);
    return { saved: true };
  }

  async delete(id: string, revision: number) {
    const removed = await this.prisma.$transaction(async (db) => {
      await lockMedia(db, this.prisma.databaseSchema, [id]);
      const asset = await db.mediaAsset.findUnique({ where: { id }, include: { _count: { select: { reports: true } } } });
      if (!asset) throw new NotFoundException('Das Bild wurde nicht gefunden.');
      if (asset.revision !== revision) throw new ConflictException('Das Bild wurde zwischenzeitlich geaendert. Bitte neu laden.');
      if (asset.status !== 'DRAFT' || asset._count.reports) {
        throw new ConflictException('Vor dem Loeschen Veroeffentlichung zuruecknehmen und Berichtszuordnungen entfernen.');
      }
      const result = await db.mediaAsset.deleteMany({ where: { id, revision, status: 'DRAFT', reports: { none: {} } } });
      if (!result.count) throw new ConflictException('Das Bild wurde zwischenzeitlich geaendert. Bitte neu laden.');
      return asset;
    });
    try { await unlink(this.path(removed.storageKey)); }
    catch (error) {
      this.logger.error(`Bild ${id} ist aus der Datenbank entfernt, die Datei konnte nicht geloescht werden.`, error);
      throw error;
    }
    return { deleted: true };
  }

  async image(id: string, publicOnly: boolean) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, ...(publicOnly ? { status: 'PUBLISHED' as const, category: { in: ['DRAWING', 'SAMMY'] as ('DRAWING' | 'SAMMY')[] } } : {}) }, select: { storageKey: true },
    });
    if (!asset) throw new NotFoundException('Das Bild ist nicht verfuegbar.');
    return readFile(this.path(asset.storageKey));
  }

  async reportImage(slug: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, category: 'TRAVEL', reports: { some: { report: { slug, status: 'PUBLISHED' } } } },
      select: { storageKey: true },
    });
    if (!asset) throw new NotFoundException('Das Bild ist in diesem Bericht nicht verfuegbar.');
    return readFile(this.path(asset.storageKey));
  }
}
