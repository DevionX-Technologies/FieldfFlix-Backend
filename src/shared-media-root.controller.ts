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
  // intent:// is the typical Android "open app or market" pattern.
  const intentUrl =
    `intent://shared/media/${encodeURIComponent(shareToken)}#Intent;` +
    `package=${ANDROID_PACKAGE};` +
    `scheme=fieldflicks;` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;

  // Branded landing page. Auto-attempts the app deep link on load, with a
  // graceful fallback to install + manual button. All inline so we don't have
  // to host CSS/images separately.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#020617" />
  <title>Watch on FieldFlicks</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    html,body{margin:0;padding:0;height:100%;}
    body{
      font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      color:#f8fafc;
      background:
        radial-gradient(1100px 600px at 80% -10%, rgba(34,197,94,0.22), transparent 60%),
        radial-gradient(900px 500px at -10% 110%, rgba(34,197,94,0.18), transparent 55%),
        linear-gradient(180deg,#020617 0%,#040d10 100%);
      min-height:100%;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:24px;
      -webkit-font-smoothing:antialiased;
    }
    .card{
      width:100%;
      max-width:420px;
      padding:34px 26px 30px;
      border-radius:24px;
      background:linear-gradient(180deg,rgba(11,31,23,0.92) 0%,rgba(7,18,14,0.96) 100%);
      border:1.5px solid rgba(34,197,94,0.28);
      box-shadow:0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(34,197,94,0.05);
      position:relative;
      overflow:hidden;
    }
    .card::before{
      content:"";
      position:absolute; inset:-1px;
      border-radius:24px; padding:1.5px;
      background:linear-gradient(135deg, rgba(34,197,94,0.7), rgba(34,197,94,0) 60%);
      -webkit-mask:linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
      -webkit-mask-composite:xor; mask-composite:exclude;
      pointer-events:none;
    }
    .logo{
      width:64px; height:64px; margin:0 auto 18px;
      border-radius:16px;
      background:linear-gradient(135deg,#22c55e,#16a34a);
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 12px 30px rgba(34,197,94,0.35);
    }
    .logo svg{width:34px;height:34px;}
    h1{
      margin:0 0 6px; text-align:center;
      font-size:22px; font-weight:800; letter-spacing:-0.01em;
    }
    .tag{
      display:inline-block; padding:4px 10px;
      font-size:11px; font-weight:600; letter-spacing:0.6px;
      border-radius:999px; text-transform:uppercase;
      background:rgba(34,197,94,0.16);
      color:#86efac;
      border:1px solid rgba(34,197,94,0.4);
    }
    .header{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:18px}
    .lead{
      margin:6px 2px 22px; text-align:center;
      color:rgba(248,250,252,0.74);
      font-size:14.5px; line-height:1.5;
    }
    .cta{
      display:flex; align-items:center; justify-content:center; gap:10px;
      width:100%;
      padding:14px 18px; border-radius:999px;
      background:linear-gradient(180deg,#22c55e,#16a34a);
      color:#022c22; font-weight:700; font-size:15px;
      text-decoration:none; letter-spacing:0.2px;
      box-shadow:0 12px 24px rgba(34,197,94,0.32);
      transition:transform 0.15s ease, box-shadow 0.15s ease;
    }
    .cta:hover{transform:translateY(-1px);box-shadow:0 16px 28px rgba(34,197,94,0.38);}
    .cta:active{transform:translateY(0);}
    .secondary{
      display:flex; align-items:center; justify-content:center; gap:8px;
      width:100%; margin-top:10px;
      padding:12px 18px; border-radius:999px;
      background:rgba(255,255,255,0.05);
      color:#e2e8f0; font-weight:600; font-size:13px;
      text-decoration:none;
      border:1px solid rgba(255,255,255,0.1);
    }
    .secondary:hover{background:rgba(255,255,255,0.08);}
    .stores{
      display:grid; grid-template-columns:1fr 1fr; gap:10px;
      margin-top:20px;
    }
    .store{
      display:flex; align-items:center; justify-content:center; gap:8px;
      padding:11px 12px; border-radius:14px;
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.08);
      color:#cbd5e1; text-decoration:none;
      font-size:12.5px; font-weight:600;
    }
    .store:hover{background:rgba(34,197,94,0.08); color:#86efac; border-color:rgba(34,197,94,0.25);}
    .store small{display:block;font-size:10px;font-weight:500;opacity:0.65;line-height:1.1}
    .store strong{font-size:13px;line-height:1.1}
    .hint{
      margin:18px 0 0;
      text-align:center;
      color:rgba(203,213,225,0.55);
      font-size:11.5px;
    }
    .arrow{transition:transform 0.2s ease;}
    .cta:hover .arrow{transform:translateX(2px);}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 5v14l11-7L8 5Z" fill="#022c22"/>
        </svg>
      </div>
      <span class="tag">FieldFlicks</span>
      <h1>Your match clip is ready</h1>
    </div>
    <p class="lead">Tap below to open this highlight inside the FieldFlicks app — full quality, full context, free to watch.</p>

    <a class="cta" href="${appScheme}" id="open-app">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 5v14l11-7L8 5Z" fill="currentColor"/>
      </svg>
      Open in app
      <svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 5l7 7-7 7"/>
      </svg>
    </a>

    <a class="secondary" href="${intentUrl}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12l7 7 7-7"/>
      </svg>
      Open on Android (app or Play Store)
    </a>

    <div class="stores">
      <a class="store" href="${PLAY_STORE_URL}" target="_blank" rel="noopener">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#86efac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m3 3 18 9-18 9V3z"/>
          <path d="M3 3l12.5 12L3 21"/>
        </svg>
        <span><small>GET IT ON</small><strong>Google Play</strong></span>
      </a>
      <a class="store" href="https://apps.apple.com/search?term=FieldFlicks" target="_blank" rel="noopener">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#86efac" aria-hidden="true">
          <path d="M16.365 1.43c0 1.14-.46 2.23-1.32 3.02-.86.78-2.04 1.34-3.06 1.26-.13-1.1.43-2.26 1.21-3.04C14 1.84 15.21 1.36 16.365 1.43Zm4.105 17.04c-.74 1.54-1.6 2.99-2.84 4.05-1.05.92-2.21 1.5-3.43 1.5-1.14 0-1.78-.71-3.06-.71-1.32 0-1.99.7-3.06.74-1.31.05-2.4-.6-3.45-1.55C2.18 19.92.6 14.66 2.45 11.06c.91-1.78 2.55-2.91 4.31-2.94 1.13-.02 2.2.79 3.06.79.86 0 2.18-.97 3.66-.83.62.03 2.36.25 3.49 1.92-.09.06-2.07 1.23-2.05 3.66.02 2.91 2.51 3.88 2.55 3.9Z"/>
        </svg>
        <span><small>DOWNLOAD ON</small><strong>App Store</strong></span>
      </a>
    </div>

    <p class="hint">Don't have the app? Install from your store and the link will continue inside FieldFlicks.</p>
  </div>

  <script>
    // Best-effort: try to open the app immediately on page load. Falls back
    // silently to the visible "Open in app" button if the scheme isn't
    // installed or the browser blocks the navigation.
    (function () {
      try {
        var ua = navigator.userAgent || '';
        var isAndroid = /android/i.test(ua);
        var hasOpened = false;
        var url = isAndroid ? ${JSON.stringify(intentUrl)} : ${JSON.stringify(appScheme)};
        var t = setTimeout(function () { /* noop — leave the page visible */ }, 1500);
        window.addEventListener('pagehide', function () { hasOpened = true; clearTimeout(t); });
        window.location.href = url;
      } catch (e) { /* ignore */ }
    })();
  </script>
</body>
</html>`;
}
