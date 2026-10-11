import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { publicContent, reportInput, requirePublishable } from './travel.input';
import { lockMedia } from '../media/media.lock';

export const PAGE_SIZE = 20;
const summarySelect = {
  id: true, title: true, slug: true, excerpt: true, destination: true, travelStart: true, travelEnd: true,
  status: true, publishedAt: true, updatedAt: true, version: true,
} as const;
const imageInclude = {
  images: { orderBy: { sortOrder: 'asc' as const }, select: {
    assetId: true, caption: true, inGallery: true,
    asset: { select: { id: true, title: true, altText: true } },
  } },
};

@Injectable()
export class TravelService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(page: number, onlyPublished = false) {
    const where: Prisma.TravelReportWhereInput = onlyPublished ? { status: 'PUBLISHED' } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.travelReport.count({ where }),
      this.prisma.travelReport.findMany({
        where, select: summarySelect, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
        orderBy: onlyPublished ? [{ publishedAt: 'desc' }, { id: 'desc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return { items, total, page, pageSize: PAGE_SIZE };
  }

  async get(id: string) {
    const report = await this.prisma.travelReport.findUnique({ where: { id }, include: imageInclude });
    if (!report) throw new NotFoundException('Reisebericht nicht gefunden.');
    return report;
  }

  async published(slug: string) {
    const report = await this.prisma.travelReport.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { ...summarySelect, contentHtml: true, ...imageInclude },
    });
    if (!report) throw new NotFoundException('Reisebericht nicht gefunden.');
    return { ...report, contentHtml: publicContent(report.contentHtml, slug, report.images.map(image => image.asset)) };
  }

  async create(body: unknown, authorId: string) {
    const input = reportInput(body);
    try {
      return await this.prisma.$transaction(async db => {
        await this.validateImages(db, input.imageIds);
        return db.travelReport.create({ data: { ...input.data, authorId, images: { create: this.imageRows(input) } }, include: imageInclude });
      });
    } catch (error) { this.rethrow(error); }
  }

  async save(id: string, body: unknown) {
    const input = reportInput(body, true);
    const { data, version } = input;
    try {
      return await this.prisma.$transaction(async (db) => {
        const current = await db.travelReport.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Reisebericht nicht gefunden.');
        if (current.status === 'PUBLISHED') requirePublishable(data);
        await this.validateImages(db, input.imageIds);
        const result = await db.travelReport.updateMany({
          where: { id, version }, data: { ...data, version: { increment: 1 } },
        });
        if (!result.count) throw new ConflictException('Der Bericht wurde inzwischen geaendert. Bitte neu laden; deine Eingaben wurden nicht gespeichert.');
        await db.reportImage.deleteMany({ where: { reportId: id } });
        await db.reportImage.createMany({ data: this.imageRows(input).map(image => ({ ...image, reportId: id })) });
        return db.travelReport.findUniqueOrThrow({ where: { id }, include: imageInclude });
      });
    } catch (error) { this.rethrow(error); }
  }

  async status(id: string, version: number, publish: boolean) {
    return this.prisma.$transaction(async (db) => {
      const report = await db.travelReport.findUnique({ where: { id } });
      if (!report) throw new NotFoundException('Reisebericht nicht gefunden.');
      if (publish) requirePublishable(report);
      const result = await db.travelReport.updateMany({
        where: { id, version },
        data: {
          status: publish ? 'PUBLISHED' : 'DRAFT',
          publishedAt: publish ? (report.publishedAt ?? new Date()) : null,
          version: { increment: 1 },
        },
      });
      if (!result.count) throw new ConflictException('Der Bericht wurde inzwischen geaendert. Bitte neu laden.');
      return db.travelReport.findUniqueOrThrow({ where: { id }, include: imageInclude });
    });
  }

  async delete(id: string, version: number) {
    const result = await this.prisma.travelReport.deleteMany({ where: { id, version, status: 'DRAFT' } });
    if (!result.count) {
      const report = await this.get(id);
      if (report.status === 'PUBLISHED') {
        throw new BadRequestException('Vor dem Loeschen die Veroeffentlichung zuruecknehmen.');
      }
      throw new ConflictException('Der Bericht wurde inzwischen geaendert. Bitte neu laden.');
    }
    return { deleted: true };
  }

  async feedItems() {
    return this.prisma.travelReport.findMany({
      where: { status: 'PUBLISHED' }, select: summarySelect,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 50,
    });
  }

  private imageRows(input: ReturnType<typeof reportInput>) {
    return input.imageIds.map(assetId => {
      const index = input.galleryImages.findIndex(image => image.assetId === assetId);
      return { assetId, inGallery: index >= 0, sortOrder: index >= 0 ? index : 100,
        caption: index >= 0 ? input.galleryImages[index]!.caption : null };
    });
  }

  private async validateImages(db: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return;
    await lockMedia(db, this.prisma.databaseSchema, ids);
    const count = await db.mediaAsset.count({ where: { id: { in: ids }, category: 'TRAVEL' } });
    if (count !== ids.length) throw new BadRequestException('Alle Berichtsbilder muessen vorhandene Bilder der Kategorie TRAVEL sein.');
  }

  private rethrow(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('Dieses URL-Kuerzel wird bereits von einem anderen Reisebericht verwendet.');
    }
    throw error;
  }
}
