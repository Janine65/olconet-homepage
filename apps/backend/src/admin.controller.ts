import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('api/admin')
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
