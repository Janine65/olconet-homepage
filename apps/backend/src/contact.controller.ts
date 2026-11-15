import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { Public } from './auth/public';
import { ContactService } from './contact.service';

@Public()
@Controller('api/public/contact')
export class ContactController {
  constructor(@Inject(ContactService) private readonly contact: ContactService) {}

  @Get('config')
  configuration() {
    return this.contact.configuration();
  }

  @Post()
  send(@Body() body: unknown) {
    return this.contact.send(body);
  }
}
