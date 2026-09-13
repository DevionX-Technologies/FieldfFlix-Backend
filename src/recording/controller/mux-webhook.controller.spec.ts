import { Test, TestingModule } from '@nestjs/testing';
import { MuxWebhookController } from './mux-webhook.controller';
import { RecordingHighlightsService } from '../service/recording-highlight.service';
import { MuxService } from 'src/mux/mux.service';
import { BadRequestException } from '@nestjs/common';

describe('MuxWebhookController', () => {
  let controller: MuxWebhookController;
  let highlightsService: jest.Mocked<Partial<RecordingHighlightsService>>;
  let muxService: jest.Mocked<Partial<MuxService>>;

  beforeEach(async () => {
    delete process.env.MUX_WEBHOOK_SECRET;

    highlightsService = {
      handleMuxWebhook: jest.fn().mockResolvedValue(undefined),
    };

    muxService = {
      verifyWebhookSignature: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MuxWebhookController],
      providers: [
        {
          provide: RecordingHighlightsService,
          useValue: highlightsService,
        },
        {
          provide: MuxService,
          useValue: muxService,
        },
      ],
    }).compile();

    controller = module.get<MuxWebhookController>(MuxWebhookController);
  });

  it('should process webhook without signature check when MUX_WEBHOOK_SECRET is not configured', async () => {
    const payload = {
      type: 'video.asset.ready',
      data: { id: 'mux-asset-123' },
    };
    const req = {
      headers: {},
      rawBody: JSON.stringify(payload),
    };

    const result = await controller.handleMuxWebhook(req, payload);

    expect(result).toEqual({ success: true });
    expect(highlightsService.handleMuxWebhook).toHaveBeenCalledWith(payload);
    expect(muxService.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('should verify signature when MUX_WEBHOOK_SECRET and signature header are provided', async () => {
    process.env.MUX_WEBHOOK_SECRET = 'test-secret';
    // Re-instantiate controller with secret
    controller = new MuxWebhookController(
      highlightsService as unknown as RecordingHighlightsService,
      muxService as unknown as MuxService,
    );

    const payload = {
      type: 'video.asset.ready',
      data: { id: 'mux-asset-123' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = 't=123456,v1=test-sig';
    const req = {
      headers: { 'mux-signature': signature },
      rawBody,
    };

    const result = await controller.handleMuxWebhook(req, payload);

    expect(result).toEqual({ success: true });
    expect(muxService.verifyWebhookSignature).toHaveBeenCalledWith(
      rawBody,
      signature,
      'test-secret',
    );
    expect(highlightsService.handleMuxWebhook).toHaveBeenCalledWith(payload);
  });

  it('should throw BadRequestException if signature verification fails', async () => {
    process.env.MUX_WEBHOOK_SECRET = 'test-secret';
    muxService.verifyWebhookSignature = jest.fn().mockImplementation(() => {
      throw new Error('Signature mismatch');
    });

    controller = new MuxWebhookController(
      highlightsService as unknown as RecordingHighlightsService,
      muxService as unknown as MuxService,
    );

    const payload = {
      type: 'video.asset.ready',
      data: { id: 'mux-asset-123' },
    };
    const req = {
      headers: { 'mux-signature': 'bad-sig' },
      rawBody: JSON.stringify(payload),
    };

    await expect(controller.handleMuxWebhook(req, payload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException if payload is empty', async () => {
    const req = {
      headers: {},
      rawBody: '',
    };

    await expect(controller.handleMuxWebhook(req, null)).rejects.toThrow(
      BadRequestException,
    );
  });
});
