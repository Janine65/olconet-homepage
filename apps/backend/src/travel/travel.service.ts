import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { hasContent, inlineImageIds, publicContent, reportInput, requirePublishable } from './travel.input';
import { lockMedia } from '../media/media.lock';
import { Language, translated, translatedMedia } from '../language';

export const PAGE_SIZE = 20;
const summarySelect = {
  id: true, title: true, slug: true, excerpt: true, destination: true, travelStart: true, travelEnd: true,
  status: true, publishedAt: true, updatedAt: true, version: true,
  titleEn: true, excerptEn: true, destinationEn: true,
} as const;
const imageInclude = {
  images: { orderBy: { sortOrder: 'asc' as const }, select: {
    assetId: true, caption: true, captionEn: true, inGallery: true,
    asset: { select: { id: true, title: true, altText: true, titleEn: true, altTextEn: true } },
  } },
};
const reportInclude = {
  ...imageInclude,
  pages: { orderBy: { sortOrder: 'asc' as const }, include: imageInclude },
};

@Injectable()
export class TravelService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(page: number, onlyPublished = false, lang: Language = 'de') {
    const where: Prisma.TravelReportWhereInput = onlyPublished ? { status: 'PUBLISHED' } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.travelReport.count({ where }),
      this.prisma.travelReport.findMany({
        where, select: summarySelect, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
        orderBy: onlyPublished ? [{ publishedAt: 'desc' }, { id: 'desc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return { items: onlyPublished ? items.map(item => this.summary(item, lang)) : items, total, page, pageSize: PAGE_SIZE };
  }

  private summary<T extends { title: string; titleEn: string; excerpt: string; excerptEn: string;
    destination: string | null; destinationEn: string }>(report: T, lang: Language) {
    return { ...report, title: translated(report.title, report.titleEn, lang),
      excerpt: translated(report.excerpt, report.excerptEn, lang),
      destination: translated(report.destination ?? '', report.destinationEn, lang) || null };
  }

  async get(id: string) {
    const report = await this.prisma.travelReport.findUnique({ where: { id }, include: reportInclude });
    if (!report) throw new NotFoundException('Reisebericht nicht gefunden.');
    return report;
  }

  async published(slug: string, lang: Language = 'de') {
    const report = await this.prisma.travelReport.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { ...summarySelect, pages: {
        where: { status: 'PUBLISHED' }, orderBy: { sortOrder: 'asc' }, include: imageInclude,
      } },
    });
    if (!report || !report.pages.length) throw new NotFoundException('Reisebericht nicht gefunden.');
    const pages = report.pages.map(page => {
      const images = page.images.map(image => ({ ...image, caption: translated(image.caption ?? '', image.captionEn, lang) || null,
        asset: translatedMedia(image.asset, lang) }));
      return {
        id: page.id, title: translated(page.title, page.titleEn, lang), publishedAt: page.publishedAt, images,
        contentHtml: publicContent(lang === 'en' && hasContent(page.contentHtmlEn) ? page.contentHtmlEn : page.contentHtml,
          slug, images.map(image => image.asset)),
      };
    });
    return { ...this.summary(report, lang), pages, contentHtml: pages[0]!.contentHtml, images: pages[0]!.images };
  }

  async create(body: unknown, authorId: string) {
    const input = reportInput(body);
    try {
      return await this.prisma.$transaction(async db => {
        await this.validateImages(db, input.imageIds);
        const report = await db.travelReport.create({ data: { ...input.data, authorId } });
        await this.savePages(db, report.id, input.pages);
        return db.travelReport.findUniqueOrThrow({ where: { id: report.id }, include: reportInclude });
      });
    } catch (error) { this.rethrow(error); }
  }

  async save(id: string, body: unknown) {
    const input = reportInput(body, true);
    const { data, version } = input;
    try {
      return await this.prisma.$transaction(async (db) => {
        const current = await db.travelReport.findUnique({ where: { id }, include: reportInclude });
        if (!current) throw new NotFoundException('Reisebericht nicht gefunden.');
        if (input.legacy && current.pages.length > 1) {
          throw new ConflictException('Dieser Bericht hat mehrere Seiten. Bitte den aktuellen Seiteneditor verwenden.');
        }
        const requestedPages = input.legacy ? input.pages.map(page => ({ ...page, id: current.pages[0]?.id ?? page.id })) : input.pages;
        const pages = requestedPages.map(page => {
          const previous = current.pages.find(saved => saved.id === page.id);
          const contentHtmlEn = page.contentHtmlEn ?? previous?.contentHtmlEn ?? '';
          return { ...page, titleEn: page.titleEn ?? previous?.titleEn ?? '', contentHtmlEn,
            galleryImages: page.galleryImages.map(image => ({ ...image,
              captionEn: image.captionEn ?? previous?.images.find(saved => saved.assetId === image.assetId)?.captionEn ?? '' })),
            imageIds: [...new Set([...page.imageIds, ...inlineImageIds(contentHtmlEn)])] };
        });
        if (pages.reduce((total, page) => total + Buffer.byteLength(page.contentHtmlEn), 0) > 100000) {
          throw new BadRequestException('Alle englischen Berichtstexte zusammen duerfen maximal 100000 UTF-8-Bytes enthalten.');
        }
        const imageIds = [...new Set(pages.flatMap(page => page.imageIds))];
        if (imageIds.length > 100) throw new BadRequestException('Maximal 100 verschiedene Bilder pro Bericht erlaubt.');
        const publishedIds = new Set(current.pages.filter(page => page.status === 'PUBLISHED').map(page => page.id));
        const published = pages.filter(page => publishedIds.has(page.id));
        for (const page of published) requirePublishable({ ...page, excerpt: data.excerpt });
        await this.validateImages(db, imageIds);
        const result = await db.travelReport.updateMany({
          where: { id, version }, data: { ...data, status: published.length ? 'PUBLISHED' : 'DRAFT',
            publishedAt: published.length ? current.publishedAt : null, version: { increment: 1 } },
        });
        if (!result.count) throw new ConflictException('Der Bericht wurde inzwischen geaendert. Bitte neu laden; deine Eingaben wurden nicht gespeichert.');
        await db.reportImage.deleteMany({ where: { reportId: id } });
        await db.reportPage.deleteMany({ where: { reportId: id, id: { notIn: pages.map(page => page.id) } } });
        await this.savePages(db, id, pages);
        return db.travelReport.findUniqueOrThrow({ where: { id }, include: reportInclude });
      });
    } catch (error) { this.rethrow(error); }
  }

  async status(id: string, version: number, publish: boolean, pageId?: string) {
    return this.prisma.$transaction(async (db) => {
      const report = await db.travelReport.findUnique({ where: { id }, include: reportInclude });
      if (!report) throw new NotFoundException('Reisebericht nicht gefunden.');
      const targets = report.pages.filter(page => !pageId || page.id === pageId);
      if (!targets.length) throw new NotFoundException('Berichtsseite nicht gefunden.');
      if (publish) for (const page of targets) {
        requirePublishable({ excerpt: report.excerpt, contentHtml: page.contentHtml, imageIds: page.images.map(image => image.assetId) });
      }
      const targetIds = new Set(targets.map(page => page.id));
      const anyPublished = report.pages.some(page => targetIds.has(page.id) ? publish : page.status === 'PUBLISHED');
      const result = await db.travelReport.updateMany({
        where: { id, version },
        data: {
          status: anyPublished ? 'PUBLISHED' : 'DRAFT',
          publishedAt: anyPublished ? (report.publishedAt ?? new Date()) : null,
          version: { increment: 1 },
        },
      });
      if (!result.count) throw new ConflictException('Der Bericht wurde inzwischen geaendert. Bitte neu laden.');
      for (const page of targets) await db.reportPage.update({
        where: { id: page.id }, data: { status: publish ? 'PUBLISHED' : 'DRAFT',
          publishedAt: publish ? (page.publishedAt ?? new Date()) : null },
      });
      return db.travelReport.findUniqueOrThrow({ where: { id }, include: reportInclude });
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

  async feedItems(lang: Language = 'de') {
    const items = await this.prisma.travelReport.findMany({
      where: { status: 'PUBLISHED' }, select: summarySelect,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 50,
    });
    return items.map(item => this.summary(item, lang));
  }

  private async savePages(db: Prisma.TransactionClient, reportId: string, pages: ReturnType<typeof reportInput>['pages']) {
    for (const [sortOrder, page] of pages.entries()) {
      const data = { title: page.title, titleEn: page.titleEn, contentHtml: page.contentHtml, contentHtmlEn: page.contentHtmlEn, sortOrder };
      await db.reportPage.upsert({
        where: { id: page.id, reportId }, create: { ...data, id: page.id, reportId }, update: data,
      });
      await db.reportImage.createMany({
        data: this.imageRows(page).map(image => ({ ...image, reportId, pageId: page.id })),
      });
    }
  }

  private imageRows(input: ReturnType<typeof reportInput>['pages'][number]) {
    return input.imageIds.map(assetId => {
      const index = input.galleryImages.findIndex(image => image.assetId === assetId);
      return { assetId, inGallery: index >= 0, sortOrder: index >= 0 ? index : 100,
        caption: index >= 0 ? input.galleryImages[index]!.caption : null,
        captionEn: index >= 0 ? input.galleryImages[index]!.captionEn ?? '' : '' };
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
      throw new ConflictException('Dieses URL-Kuerzel oder diese Seiten-ID wird bereits verwendet.');
    }
    throw error;
  }
}
