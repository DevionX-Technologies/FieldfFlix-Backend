import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from 'src/decorators/public.decorator';
import { CommonService } from 'src/common/service/common.service';
import { RecordingService } from 'src/recording/service/recording.service';
import { successResponse } from 'src/responses/response-utils';

const ANDROID_PACKAGE = 'com.fieldflicks';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/**
 * Public entry at `GET /shared/media/:token` (no `/recording` prefix) so
 * `APP_BASE_URL/shared/media/<token>` matches the deep link in the app
 * (`/shared/media/[token]`) and can be verified for App / Universal links.
 * JSON responses use the same envelope as the rest of the API.
 * Browsers (Accept: text/html) get a small HTML page with “Open in app” + store links.
 */
@Controller()
export class SharedMediaRootController {
  constructor(
    private readonly recordingService: RecordingService,
    private readonly commonService: CommonService,
  ) {}

  @Public()
  @Get('shared/media/:share_token')
  @HttpCode(200)
  async resolve(
    @Req() req: Request,
    @Res() res: Response,
    @Param('share_token') shareToken: string,
  ) {
    const accept = (req.get('accept') || '').toLowerCase();
    const wantsHtml =
      accept.includes('text/html') && !accept.startsWith('application/json');

    let viewerUserId: string | null = null;
    try {
      const tokenData = await this.commonService.extractDataFromToken(req);
      viewerUserId = tokenData?.user_id ?? null;
    } catch {
      viewerUserId = null;
    }

    const resolved = await this.recordingService.resolveShareToken(
      shareToken,
      viewerUserId,
    );

    if (wantsHtml) {
      if (!resolved) {
        return res
          .status(404)
          .type('text/html; charset=utf-8')
          .send(
            '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width" /><title>Highlights page</title></head><body style="font-family:system-ui;padding:24px">Link invalid or expired.</body></html>',
          );
      }
      return res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(shareLinkBridgeHtml(shareToken));
    }

    if (!resolved) {
      throw new NotFoundException('Shared media not found or token is invalid.');
    }

    const payload = {
      ...resolved,
      presignedUrl: resolved.mux_media_url,
    };
    return res
      .status(200)
      .json(
        successResponse('GET_/shared/media/:share_token', payload),
      );
  }
}

function shareLinkBridgeHtml(shareToken: string): string {
  const appScheme = `fieldflicks://shared/media/${encodeURIComponent(shareToken)}`;
  // intent:// is the typical Android “open app or market” pattern
  const intentUrl =
    `intent://shared/media/${encodeURIComponent(shareToken)}#Intent;` +
    `package=${ANDROID_PACKAGE};` +
    `scheme=fieldflicks;` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Highlights page</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 0 auto; padding: 1.5rem; background: #0a0a0a; color: #e5e5e5; }
    a { color: #22c55e; }
    .btn { display: inline-block; margin: 0.5rem 0.5rem 0.5rem 0; padding: 0.75rem 1.25rem; background: #22c55e; color: #fff; text-decoration: none; border-radius: 9999px; font-weight: 600; }
  </style>
</head>
<body>
  <h1 style="font-size:1.25rem">Highlights page</h1>
  <p>This link opens a shared match clip in the app.</p>
  <p>
    <a class="btn" href="${appScheme}">Open in app</a>
  </p>
  <p><a href="${intentUrl}">Open on Android (app or Play Store)</a></p>
  <p style="font-size:0.9rem;opacity:0.8">Install: <a href="${PLAY_STORE_URL}">Google Play</a> · <a href="https://apps.apple.com/search?term=FieldFlicks">App Store</a></p>
</body>
</html>`;
}
