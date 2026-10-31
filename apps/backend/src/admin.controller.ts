import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { visitorTotals } from './visitors.controller';

function packageVersion(path: string) {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string' || !data.version.trim()) {
    throw new Error(`Ungültige Paketversion: ${path}`);
  }
  return data.version;
}

@Controller('api/admin')
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('system')
  async system() {
    return {
      versions: {
        release: packageVersion(resolve(__dirname, '../../../package.json')),
        homepage: packageVersion(resolve(__dirname, '../../homepage/package.json')),
        admin: packageVersion(resolve(__dirname, '../../admin/package.json')),
        backend: packageVersion(resolve(__dirname, '../package.json')),
      },
      visitors: await visitorTotals(this.prisma),
    };
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
