import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/public';
import { pageNumber, record, reportId, reportVersion } from '../travel/travel.input';
import { MAX_UPLOAD_BYTES } from './image';
import { Multipart } from './multipart';
import { MediaService } from './media.service';

const revision = (body: unknown) => reportVersion(record(body, ['revision'])['revision']);
const imageResponse = (buffer: Buffer) => new StreamableFile(buffer, { type: 'image/webp', length: buffer.length });

@Controller('api/admin/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get()
  list(@Query('page') page: unknown, @Query('category') category: unknown) {
    return this.media.list(pageNumber(page), category);
  }

  @Get('order')
  order(@Query('category') category: unknown, @Query('page') page: unknown) {
    return this.media.order(category, pageNumber(page));
  }

  @Post('order/move')
  move(@Body() body: unknown) { return this.media.move(body); }

  @Get(':id/image')
  async image(@Param('id') id: string) { return imageResponse(await this.media.image(reportId(id), false)); }

  @Get(':id')
  get(@Param('id') id: string) { return this.media.get(reportId(id)); }

  @Post()
  @Multipart()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 1, fieldSize: 16000, parts: 2 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, unknown>) {
    if (Object.keys(body).length !== 1 || typeof body['metadata'] !== 'string') {
      throw new BadRequestException('Nur eine Bilddatei und metadata sind erlaubt.');
    }
    let metadata: unknown;
    try { metadata = JSON.parse(body['metadata']); }
    catch { throw new BadRequestException('metadata muss gueltiges JSON enthalten.'); }
    return this.media.upload(file, metadata);
  }

  @Post(':id/save')
  save(@Param('id') id: string, @Body() body: unknown) { return this.media.save(reportId(id), body); }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() body: unknown) { return this.media.status(reportId(id), revision(body), true); }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @Body() body: unknown) { return this.media.status(reportId(id), revision(body), false); }

  @Post(':id/delete')
  delete(@Param('id') id: string, @Body() body: unknown) { return this.media.delete(reportId(id), revision(body)); }
}

@Public()
@Controller('api/public/media')
export class PublicMediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get()
  list(@Query('page') page: unknown, @Query('category') category: unknown) {
    return this.media.list(pageNumber(page), category, true);
  }

  @Get(':id/image')
  async image(@Param('id') id: string) { return imageResponse(await this.media.image(reportId(id), true)); }
}
