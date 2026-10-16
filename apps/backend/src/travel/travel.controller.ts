import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuthRequest } from '../auth/auth.guard';
import { TravelService } from './travel.service';
import { pageNumber, record, reportId, reportVersion } from './travel.input';

@Controller('api/admin/reports')
export class TravelController {
  constructor(@Inject(TravelService) private readonly reports: TravelService) {}

  @Get()
  list(@Query('page') page: unknown) { return this.reports.list(pageNumber(page)); }

  @Get(':id')
  get(@Param('id') id: string) { return this.reports.get(reportId(id)); }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthRequest) {
    if (!request.authUser) throw new Error('AuthGuard hat kein Verwaltungskonto bereitgestellt.');
    return this.reports.create(body, request.authUser.id);
  }

  @Post(':id/save')
  save(@Param('id') id: string, @Body() body: unknown) { return this.reports.save(reportId(id), body); }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() body: unknown) {
    return this.reports.status(reportId(id), reportVersion(record(body, ['version'])['version']), true);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @Body() body: unknown) {
    return this.reports.status(reportId(id), reportVersion(record(body, ['version'])['version']), false);
  }

  @Post(':id/pages/:pageId/publish')
  publishPage(@Param('id') id: string, @Param('pageId') pageId: string, @Body() body: unknown) {
    return this.reports.status(reportId(id), reportVersion(record(body, ['version'])['version']), true, reportId(pageId));
  }

  @Post(':id/pages/:pageId/unpublish')
  unpublishPage(@Param('id') id: string, @Param('pageId') pageId: string, @Body() body: unknown) {
    return this.reports.status(reportId(id), reportVersion(record(body, ['version'])['version']), false, reportId(pageId));
  }

  @Post(':id/delete')
  delete(@Param('id') id: string, @Body() body: unknown) {
    return this.reports.delete(reportId(id), reportVersion(record(body, ['version'])['version']));
  }
}
