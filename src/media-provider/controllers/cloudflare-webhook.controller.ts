import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { CloudflareWebhookService } from '../services/cloudflare-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class CloudflareWebhookController {
  private readonly logger = new Logger(CloudflareWebhookController.name);

  constructor(private readonly webhookService: CloudflareWebhookService) {}

  @Public()
  @Post('cloudflare')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Handle Cloudflare Stream & Media webhook events',
    description:
      'Receives, cryptographically verifies, deduplicates, and normalizes Cloudflare Stream webhook events.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed or deduplicated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        deduplicated: { type: 'boolean' },
        eventId: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook signature or payload',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error processing webhook',
  })
  async handleCloudflareWebhook(@Req() req: any, @Body() body: any) {
    const signature =
      (req.headers['webhook-signature'] as string) ||
      (req.headers['cf-webhook-signature'] as string) ||
      '';

    let rawBody = req.rawBody;

    // Resolve rawBody string
    if (!rawBody) {
      if (body && typeof body === 'object') {
        try {
          rawBody = JSON.stringify(body);
        } catch {
          rawBody = '';
        }
      } else {
        rawBody = '';
      }
    } else if (typeof rawBody !== 'string') {
      if (Buffer.isBuffer(rawBody)) {
        rawBody = rawBody.toString('utf8');
      } else if (typeof rawBody === 'object') {
        try {
          rawBody = JSON.stringify(rawBody);
        } catch {
          rawBody = '';
        }
      } else {
        rawBody = String(rawBody);
      }
    }

    // Parse body if req.body wasn't parsed
    let parsedPayload = body;
    if (!parsedPayload || Object.keys(parsedPayload).length === 0) {
      if (rawBody) {
        try {
          parsedPayload = JSON.parse(rawBody);
        } catch (e) {
          this.logger.error(
            'Failed to parse Cloudflare webhook rawBody as JSON',
            e.message,
          );
          throw new BadRequestException('Invalid JSON payload');
        }
      }
    }

    if (!parsedPayload || Object.keys(parsedPayload).length === 0) {
      throw new BadRequestException('Empty webhook payload');
    }

    // 1. Cryptographic HMAC-SHA256 signature verification
    this.webhookService.verifyWebhookSignature(rawBody, signature);

    // 2. Event normalization
    const eventIdHeader = req.headers['cf-ray'] as string | undefined;
    const normalized = this.webhookService.normalizeEvent(
      parsedPayload,
      eventIdHeader,
    );

    this.logger.log(
      `Received normalized Cloudflare webhook: ${normalized.eventType}`,
      {
        eventId: normalized.eventId,
        assetId: normalized.assetId,
        status: normalized.status,
      },
    );

    // 3. Database / In-memory Idempotency check
    const { isDuplicate } = await this.webhookService.recordEventIdempotent(
      normalized.eventId,
      normalized.eventType,
      normalized.assetId,
    );

    if (isDuplicate) {
      this.logger.warn(
        `Cloudflare webhook event already processed: ${normalized.eventId}`,
      );
      return {
        success: true,
        deduplicated: true,
        eventId: normalized.eventId,
      };
    }

    // 4. State handling based on event type
    try {
      switch (normalized.eventType) {
        case 'live.connected':
        case 'live.reconnecting':
        case 'live.disconnected':
          this.logger.log(
            `Live session event [${normalized.eventType}] for input ${normalized.assetId}`,
          );
          break;

        case 'video.ready':
          this.logger.log(
            `VOD asset [${normalized.assetId}] is ready. Playback URL: ${normalized.playbackUrl}`,
          );
          break;

        case 'video.failed':
          this.logger.warn(
            `VOD asset [${normalized.assetId}] processing failed.`,
          );
          break;

        case 'video.upload_complete':
          this.logger.log(
            `VOD asset [${normalized.assetId}] direct upload completed.`,
          );
          break;

        default:
          this.logger.debug(
            `Unhandled or custom Cloudflare event type: ${normalized.rawEventType}`,
          );
          break;
      }

      return {
        success: true,
        deduplicated: false,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
      };
    } catch (err: any) {
      this.logger.error(`Error processing Cloudflare webhook: ${err.message}`, {
        eventId: normalized.eventId,
        stack: err.stack,
      });
      throw new InternalServerErrorException(
        `Failed to process Cloudflare webhook: ${err.message}`,
      );
    }
  }
}
