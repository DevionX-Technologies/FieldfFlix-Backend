import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  Optional,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../../decorators/public.decorator';
import { CloudflareWebhookService } from '../services/cloudflare-webhook.service';
import { Recording } from '../../recording/entities/recording.entity';
import { ExtractionJobProgressService } from '../../extraction-queue/extraction-job-progress.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class CloudflareWebhookController {
  private readonly logger = new Logger(CloudflareWebhookController.name);

  constructor(
    private readonly webhookService: CloudflareWebhookService,
    @Optional()
    @InjectRepository(Recording)
    private readonly recordingRepository?: Repository<Recording>,
    @Optional()
    private readonly jobProgress?: ExtractionJobProgressService,
  ) {}

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

        case 'video.ready': {
          this.logger.log(
            `VOD asset [${normalized.assetId}] is ready. Playback URL: ${normalized.playbackUrl}`,
          );

          if (this.recordingRepository && normalized.assetId) {
            try {
              const recording = await this.recordingRepository
                .createQueryBuilder('r')
                .where("r.metadata->>'cloudflareStreamUid' = :uid", {
                  uid: normalized.assetId,
                })
                .orWhere("r.metadata->>'cf_uid' = :uid", {
                  uid: normalized.assetId,
                })
                .orWhere("r.metadata->>'uploadId' = :uid", {
                  uid: normalized.assetId,
                })
                .orWhere('r.mux_playback_id = :uid', {
                  uid: normalized.assetId,
                })
                .getOne();

              if (recording) {
                const meta = (recording.metadata ?? {}) as Record<
                  string,
                  unknown
                >;
                const playbackUrl =
                  normalized.playbackUrl ||
                  `https://videodelivery.net/${normalized.assetId}/manifest/video.m3u8`;

                // Cloudflare Stream values stay in the `cloudflare*` namespace;
                // `mux_playback_id` is reserved for the Mux provider.
                await this.recordingRepository.update(recording.id, {
                  status: 'ready',
                  isVideoCreated: true,
                  metadata: {
                    ...meta,
                    cloudflareStreamStatus: 'ready',
                    cloudflarePlaybackUrl: playbackUrl,
                    cloudflareReadyAt: new Date().toISOString(),
                  } as any,
                });

                // Advance the extraction job so the pipeline tracker reflects
                // STREAM_READY instead of stalling at R2_READY.
                await this.jobProgress?.onStreamReady(recording.id);

                this.logger.log(
                  `Updated recording ${recording.id} to ready from Cloudflare Stream webhook`,
                );
              }
            } catch (dbErr: any) {
              this.logger.warn(
                `Failed to update recording on video.ready for ${normalized.assetId}: ${dbErr?.message}`,
              );
            }
          }
          break;
        }

        case 'video.failed': {
          this.logger.warn(
            `VOD asset [${normalized.assetId}] processing failed.`,
          );
          if (this.recordingRepository && normalized.assetId) {
            try {
              const recording = await this.recordingRepository
                .createQueryBuilder('r')
                .where("r.metadata->>'cloudflareStreamUid' = :uid", {
                  uid: normalized.assetId,
                })
                .orWhere("r.metadata->>'cf_uid' = :uid", {
                  uid: normalized.assetId,
                })
                .orWhere("r.metadata->>'uploadId' = :uid", {
                  uid: normalized.assetId,
                })
                .orWhere('r.mux_playback_id = :uid', {
                  uid: normalized.assetId,
                })
                .getOne();

              if (recording) {
                const meta = (recording.metadata ?? {}) as Record<
                  string,
                  unknown
                >;
                // If the raw MP4 is already in R2 storage, keep recording playable!
                const isDirectReady = Boolean(
                  meta.r2Status === 'ready' && meta.r2VerifiedAt,
                );
                await this.recordingRepository.update(recording.id, {
                  status: isDirectReady ? 'ready' : 'failed',
                  metadata: {
                    ...meta,
                    cloudflareStreamStatus: 'failed',
                    cloudflareStreamError:
                      (normalized as any).rawProviderResponse?.status
                        ?.errorReasonText ||
                      (parsedPayload as any)?.status?.errorReasonText ||
                      'Processing failed',
                  } as any,
                });
              }
            } catch (dbErr: any) {
              this.logger.warn(
                `Failed to update recording on video.failed: ${dbErr?.message}`,
              );
            }
          }
          break;
        }

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
