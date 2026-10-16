import { Controller, Get, Inject, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public';
import { TravelService } from './travel.service';
import { pageNumber, reportId } from './travel.input';
import { MediaService } from '../media/media.service';
import { readSiteUrl, rss } from './rss';
import { language } from '../language';

@Public()
@Controller('api/public/reports')
export class PublicTravelController {
  private readonly site = readSiteUrl(process.env);
  constructor(@Inject(TravelService) private readonly reports: TravelService,
    @Inject(MediaService) private readonly media: MediaService) {}

  @Get()
  list(@Query('page') page: unknown, @Query('lang') lang: unknown) { return this.reports.list(pageNumber(page), true, language(lang)); }

  @Get('rss')
  async feed(@Res() response: Response, @Query('lang') value: unknown) {
    const lang = language(value);
    response.type('application/rss+xml').send(rss(await this.reports.feedItems(lang), this.site, lang));
  }

  @Get(':slug')
  get(@Param('slug') slug: string, @Query('lang') lang: unknown) { return this.reports.published(slug, language(lang)); }

  @Get(':slug/images/:id')
  async image(@Param('slug') slug: string, @Param('id') id: string) {
    return new StreamableFile(await this.media.reportImage(slug, reportId(id)), { type: 'image/webp' });
  }
}
