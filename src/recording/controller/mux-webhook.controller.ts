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
    this.logger.log('Mux webhook received', {
      headers: {
        'mux-signature': req.headers['mux-signature'],
        'content-type': req.headers['content-type'],
      },
      rawBodyLength: req.rawBody?.length || 0,
      rawBodyType: typeof req.rawBody,
      parsedBodyType: typeof body,
    });

    // const signature = req.headers['mux-signature'] as string;
    let rawBody = req.rawBody;

    if (!this.muxSigningSecret) {
      this.logger.error('MUX_WEBHOOK_SECRET not configured in environment');
      throw new InternalServerErrorException(
        'Server webhook secret not configured',
      );
    }

    if (!rawBody) {
      this.logger.error('Raw body not available for signature verification');
      throw new BadRequestException('Raw body not available');
    }

    // Ensure rawBody is a string as required by Mux signature verification
    if (typeof rawBody !== 'string') {
      if (Buffer.isBuffer(rawBody)) {
        rawBody = rawBody.toString('utf8');
        this.logger.debug('Converted Buffer to string for verification');
      } else if (typeof rawBody === 'object') {
        try {
          rawBody = JSON.stringify(rawBody);
          this.logger.debug('Converted object to JSON string for verification');
        } catch (e) {
          this.logger.error('Failed to convert object to JSON string', {
            rawBodyType: typeof rawBody,
            error: e.message,
          });
          throw new BadRequestException('Invalid raw body format');
        }
      } else {
        rawBody = String(rawBody);
        this.logger.debug('Converted raw body to string using String() method');
      }
    }

    this.logger.debug('Final raw body details', {
      rawBodyType: typeof rawBody,
      rawBodyLength: rawBody.length,
      rawBodyPreview: rawBody.substring(0, 200),
    });

    // Check if the body was already parsed by NestJS
    if (!body || Object.keys(body).length === 0) {
      this.logger.error('Parsed body is empty');
      throw new BadRequestException('Invalid JSON payload');
    }

    // try {
    //   // Use the corrected Mux webhook signature verification
    //   this.muxService.verifyWebhookSignatureOld(
    //     rawBody, // Raw body as string
    //     req.headers, // Mux-signature header value
    //     this.muxSigningSecret, // Webhook secret
    //   );
    //   this.logger.log('Webhook signature verified successfully');
    // } catch (error) {
    //   this.logger.error(`Webhook verification failed: ${error.message}`, {
    //     signature,
    //     bodyType: typeof rawBody,
    //     bodyLength: rawBody?.length,
    //     hasSecret: !!this.muxSigningSecret,
    //   });
    //   throw new BadRequestException(
    //     `Invalid webhook signature: ${error.message}`,
    //   );
    // }

    try {
      // Use the parsed body for processing
      await this.recordingHighlightsService.handleMuxWebhook(body);
      this.logger.log('Webhook processed successfully', {
        eventType: body?.type,
        assetId: body?.data?.id,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error.message}`, {
        eventType: body?.type,
        assetId: body?.data?.id,
        error: error.stack,
      });
      throw new InternalServerErrorException(
        `Webhook processing failed: ${error.message}`,
      );
    }
  }
}
