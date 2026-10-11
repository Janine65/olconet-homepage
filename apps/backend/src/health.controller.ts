import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './auth/public';

@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected' };
    } catch {
      this.logger.error('Readiness fehlgeschlagen: PostgreSQL ist nicht erreichbar.');
      throw new ServiceUnavailableException('Datenbank nicht erreichbar.');
    }
  }
}
