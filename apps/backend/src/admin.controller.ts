import { Controller, Get, Inject, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VisitorAnalyticsService } from './visitor-analytics.service';

function packageVersion(path: string) {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string' || !data.version.trim()) {
    throw new Error(`Ungültige Paketversion: ${path}`);
  }
  return data.version;
}

@Controller('api/admin')
export class AdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisitorAnalyticsService) private readonly visitorAnalytics: VisitorAnalyticsService,
  ) {}

  @Get('system')
  async system() {
    return {
      versions: {
        release: packageVersion(resolve(__dirname, '../../../package.json')),
        homepage: packageVersion(resolve(__dirname, '../../homepage/package.json')),
        admin: packageVersion(resolve(__dirname, '../../admin/package.json')),
        backend: packageVersion(resolve(__dirname, '../package.json')),
      },
    };
  }

  @Get('visitors')
  visitors(@Query('from') from?: string, @Query('to') to?: string) {
    return this.visitorAnalytics.report(from, to);
  }

  @Get('overview')
  async overview() {
    const [reports, drawings, sammyPhotos] = await this.prisma.$transaction([
      this.prisma.travelReport.count(),
      this.prisma.mediaAsset.count({ where: { category: 'DRAWING', parentId: null } }),
      this.prisma.mediaAsset.count({ where: { category: 'SAMMY', parentId: null } }),
    ]);
    return { reports, drawings, sammyPhotos };
  }
}
