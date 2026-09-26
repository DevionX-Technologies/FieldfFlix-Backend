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
    // Reports presence only — never echo key material on a public route.
    const has = (key: string) => Boolean((process.env[key] || '').trim());
    return {
      storage_provider: process.env.MEDIA_STORAGE_PROVIDER || '(unset)',
      bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'NOT_SET',
      public_url: process.env.CLOUDFLARE_R2_PUBLIC_URL || 'NOT_SET',
      account_id_set: has('CLOUDFLARE_ACCOUNT_ID'),
      r2_access_key_set: has('CLOUDFLARE_R2_ACCESS_KEY_ID'),
      r2_secret_key_set: has('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
      r2_endpoint_set: has('CLOUDFLARE_R2_ENDPOINT'),
      stream_account_id_set: has('CLOUDFLARE_ACCOUNT_ID'),
      stream_api_token_set: has('CLOUDFLARE_STREAM_API_TOKEN'),
      node_env: process.env.NODE_ENV,
    };
  }
}
