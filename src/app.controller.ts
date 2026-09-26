import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('debug-env')
  getDebugEnv(): any {
    return {
      bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'NOT_SET',
      account: !!process.env.CLOUDFLARE_R2_ACCOUNT_ID,
      node_env: process.env.NODE_ENV,
    };
  }
}
