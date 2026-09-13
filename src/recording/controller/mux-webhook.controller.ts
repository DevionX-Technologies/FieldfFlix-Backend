// src/webhooks/mux-webhook.controller.ts
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
import { RecordingHighlightsService } from 'src/recording/service/recording-highlight.service'; // Adjust the path
import { MuxService } from 'src/mux/mux.service';
import { Public } from 'src/decorators/public.decorator';

@ApiTags('Webhooks')
@Controller('webhooks')
export class MuxWebhookController {
  private readonly logger = new Logger(MuxWebhookController.name);
  private readonly muxSigningSecret: string;

  constructor(
    private readonly recordingHighlightsService: RecordingHighlightsService,
    private readonly muxService: MuxService,
  ) {
    this.muxSigningSecret = process.env.MUX_WEBHOOK_SECRET;
  }

  @Public()
  @Post('mux')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Handle Mux webhook events',
    description:
      'Receives and verifies Mux webhook events, then processes them.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook signature or payload',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error processing webhook',
  })
  async handleMuxWebhook(@Req() req: any, @Body() body: any) {
    const signature = req.headers['mux-signature'] as string;
    let rawBody = req.rawBody;

    this.logger.log('Mux webhook received', {
      headers: {
        'mux-signature': signature ? 'present' : 'absent',
        'content-type': req.headers['content-type'],
      },
      rawBodyLength: req.rawBody?.length || 0,
      rawBodyType: typeof req.rawBody,
      parsedBodyType: typeof body,
    });

    // Ensure rawBody is a string
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

    // Verify signature if secret and signature are available
    if (!this.muxSigningSecret) {
      this.logger.warn(
        'MUX_WEBHOOK_SECRET not configured in environment, proceeding without signature verification',
      );
    } else if (signature && rawBody) {
      try {
        this.muxService.verifyWebhookSignature(
          rawBody,
          signature,
          this.muxSigningSecret,
        );
        this.logger.log('Webhook signature verified successfully');
      } catch (error) {
        this.logger.error(
          `Webhook signature verification failed: ${error.message}`,
          {
            signature,
            bodyLength: rawBody?.length,
          },
        );
        throw new BadRequestException(
          `Invalid webhook signature: ${error.message}`,
        );
      }
    } else if (signature && !rawBody) {
      this.logger.warn(
        'Mux signature provided but rawBody could not be resolved',
      );
    }

    // Parse body if req.body wasn't parsed by json middleware
    let parsedPayload = body;
    if (!parsedPayload || Object.keys(parsedPayload).length === 0) {
      if (rawBody) {
        try {
          parsedPayload = JSON.parse(rawBody);
        } catch (e) {
          this.logger.error(
            'Failed to parse webhook rawBody as JSON',
            e.message,
          );
        }
      }
    }

    if (!parsedPayload || Object.keys(parsedPayload).length === 0) {
      this.logger.error('Parsed body is empty');
      throw new BadRequestException('Invalid JSON payload');
    }

    try {
      await this.recordingHighlightsService.handleMuxWebhook(parsedPayload);
      this.logger.log('Webhook processed successfully', {
        eventType: parsedPayload?.type,
        assetId: parsedPayload?.data?.id,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error.message}`, {
        eventType: parsedPayload?.type,
        assetId: parsedPayload?.data?.id,
        error: error.stack,
      });
      throw new InternalServerErrorException(
        `Webhook processing failed: ${error.message}`,
      );
    }
  }
}
