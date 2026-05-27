import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  findMyPhone(): string {
    return this.appService.findMyPhone();
  }
}
