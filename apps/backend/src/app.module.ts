import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AdminController } from './admin.controller';
import { HttpErrorFilter } from './http-error.filter';
import { TravelService } from './travel/travel.service';
import { TravelController } from './travel/travel.controller';
import { PublicTravelController } from './travel/public-travel.controller';
import { MediaService } from './media/media.service';
import { MediaController, PublicMediaController } from './media/media.controller';

@Module({
  controllers: [HealthController, AuthController, AdminController, TravelController, PublicTravelController, MediaController, PublicMediaController],
  providers: [
    PrismaService, AuthService, TravelService, MediaService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
