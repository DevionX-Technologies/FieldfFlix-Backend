import { Test, TestingModule } from '@nestjs/testing';
import { RecordingController } from './controller/recording.controller';
import { StartRecordingDto } from './dto/start-recording.dto';
import { StopRecordingDto } from './dto/stop-recording.dto';
import { Recording } from './entities/recording.entity';
import {
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileServiceService } from '../file-service/file-service.service';
import { CommonService } from 'src/common/service/common.service';
import { ConfigService } from '@nestjs/config';
import { RecordingService } from './service/recording.service';

import { RecordingHighlightsService } from './service/recording-highlight.service';
import { MuxService } from '../mux/mux.service';
import { RecordingHighlightEngagementService } from './service/recording-highlight-engagement.service';
import { CloudflarePlaybackTokenService } from '../media-provider/services/cloudflare-playback-token.service';

describe('RecordingController', () => {
  let controller: RecordingController;
  let recordingService: jest.Mocked<RecordingService>;
  let fileServiceService: jest.Mocked<FileServiceService>;

  beforeEach(async () => {
    recordingService = {
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      findActiveRecordingByCamera: jest.fn(),
      getRecordingById: jest.fn(),
      getRecordingS3Path: jest.fn(),
      getMuxPublicUrl: jest.fn(),
      isRecordingMuxPlayable: jest.fn().mockReturnValue(true),
    } as any;

    fileServiceService = {
      getVideoStream: jest.fn(),
      getSignedUrlFromS3: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingController],
      providers: [
        {
          provide: RecordingService,
          useValue: recordingService,
        },
        {
          provide: FileServiceService,
          useValue: fileServiceService,
        },
        {
          provide: CommonService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {},
        },
        {
          provide: RecordingHighlightsService,
          useValue: {},
        },
        {
          provide: MuxService,
          useValue: {},
        },
        {
          provide: RecordingHighlightEngagementService,
          useValue: {},
        },
        {
          provide: CloudflarePlaybackTokenService,
          useValue: {
            generateSignedToken: jest.fn().mockResolvedValue({
              token: 'signed_cf_jwt_token_123',
              expiresAt: new Date('2026-09-24T18:00:00Z'),
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<RecordingController>(RecordingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('startRecording', () => {
    const startRecordingDto: StartRecordingDto = {
      userId: 'test-user-id',
      cameraId: 'test-camera-id',
      turfId: 'test-turf-id',
      metadata: { key: 'value' },
    };

    it('should call recordingService.startRecording and return the result', async () => {
      const expectedResult = {
        id: 'new-rec-id',
        ...startRecordingDto,
        status: 'in_progress',
      } as Recording;
      recordingService.startRecording.mockResolvedValue(expectedResult);

      const result = await controller.startRecording(startRecordingDto);

      expect(recordingService.startRecording).toHaveBeenCalledWith(
        startRecordingDto,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should re-throw NotFoundException from the service', async () => {
      recordingService.startRecording.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        controller.startRecording(startRecordingDto),
      ).rejects.toThrow(NotFoundException);
      expect(recordingService.startRecording).toHaveBeenCalledWith(
        startRecordingDto,
      );
    });

    it('should re-throw ConflictException from the service', async () => {
      recordingService.startRecording.mockRejectedValue(
        new ConflictException(),
      );

      await expect(
        controller.startRecording(startRecordingDto),
      ).rejects.toThrow(ConflictException);
      expect(recordingService.startRecording).toHaveBeenCalledWith(
        startRecordingDto,
      );
    });

    it('should re-throw InternalServerErrorException from the service', async () => {
      recordingService.startRecording.mockRejectedValue(
        new InternalServerErrorException(),
      );

      await expect(
        controller.startRecording(startRecordingDto),
      ).rejects.toThrow(InternalServerErrorException);
      expect(recordingService.startRecording).toHaveBeenCalledWith(
        startRecordingDto,
      );
    });
  });

  describe('stopRecording', () => {
    const recordingId = 'test-recording-id';
    const stopRecordingDto: StopRecordingDto = { recordingId };

    it('should call recordingService.stopRecording and return the result', async () => {
      const expectedResult = {
        id: recordingId,
        status: 'completed',
        s3Path: 's3://path',
      } as Recording;
      recordingService.stopRecording.mockResolvedValue(expectedResult);

      const result = await controller.stopRecording(
        recordingId,
        stopRecordingDto,
      );

      expect(recordingService.stopRecording).toHaveBeenCalledWith(recordingId);
      expect(result).toEqual(expectedResult);
    });

    it('should re-throw NotFoundException from the service', async () => {
      recordingService.stopRecording.mockRejectedValue(new NotFoundException());

      await expect(
        controller.stopRecording(recordingId, stopRecordingDto),
      ).rejects.toThrow(NotFoundException);
      expect(recordingService.stopRecording).toHaveBeenCalledWith(recordingId);
    });

    it('should re-throw InternalServerErrorException from the service', async () => {
      recordingService.stopRecording.mockRejectedValue(
        new InternalServerErrorException(),
      );

      await expect(
        controller.stopRecording(recordingId, stopRecordingDto),
      ).rejects.toThrow(InternalServerErrorException);
      expect(recordingService.stopRecording).toHaveBeenCalledWith(recordingId);
    });
  });

  describe('getRecordingById', () => {
    const recordingId = 'test-recording-id';

    it('should call recordingService.getRecordingById and return the result if found', async () => {
      const expectedRecording = {
        id: recordingId,
        status: 'completed',
        user: { id: 'user-id' },
        camera: { id: 'camera-id' },
      } as Recording;
      recordingService.getRecordingById.mockResolvedValue(expectedRecording);
      recordingService.getMuxPublicUrl.mockResolvedValue({
        publicUrl: 'https://stream.mux.com/test.m3u8',
      } as any);

      const result = await controller.getRecordingById(recordingId);

      expect(recordingService.getRecordingById).toHaveBeenCalledWith(
        recordingId,
      );
      expect(recordingService.getMuxPublicUrl).toHaveBeenCalledWith(
        recordingId,
      );
      expect(result).toEqual({
        ...expectedRecording,
        mux_public_url: 'https://stream.mux.com/test.m3u8',
      });
    });

    it('should throw NotFoundException if recording is not found', async () => {
      recordingService.getRecordingById.mockResolvedValue(null);

      await expect(controller.getRecordingById(recordingId)).rejects.toThrow(
        NotFoundException,
      );
      expect(recordingService.getRecordingById).toHaveBeenCalledWith(
        recordingId,
      );
    });
  });

  describe('streamRecording', () => {
    const recordingId = 'test-recording-id';
    const dummyS3Key = 'dummy/s3/path/video.mp4';
    const dummySignedUrl = 'https://s3.signed.url/video.mp4';
    const mockResponse = { redirect: jest.fn() } as any;

    it('should redirect to signed S3 URL on success', async () => {
      recordingService.getRecordingS3Path.mockResolvedValue(dummyS3Key);
      fileServiceService.getSignedUrlFromS3.mockResolvedValue(dummySignedUrl);

      await controller.streamRecording(recordingId, mockResponse);

      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      expect(fileServiceService.getSignedUrlFromS3).toHaveBeenCalledWith(
        dummyS3Key,
      );
      expect(mockResponse.redirect).toHaveBeenCalledWith(302, dummySignedUrl);
    });

    it('should re-throw NotFoundException from getRecordingS3Path', async () => {
      recordingService.getRecordingS3Path.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        controller.streamRecording(recordingId, mockResponse),
      ).rejects.toThrow(NotFoundException);
      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      expect(fileServiceService.getSignedUrlFromS3).not.toHaveBeenCalled();
    });

    it('should re-throw InternalServerErrorException from getRecordingS3Path', async () => {
      recordingService.getRecordingS3Path.mockRejectedValue(
        new InternalServerErrorException(),
      );

      await expect(
        controller.streamRecording(recordingId, mockResponse),
      ).rejects.toThrow(InternalServerErrorException);
      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      expect(fileServiceService.getSignedUrlFromS3).not.toHaveBeenCalled();
    });

    it('should re-throw NotFoundException from getSignedUrlFromS3', async () => {
      recordingService.getRecordingS3Path.mockResolvedValue(dummyS3Key);
      fileServiceService.getSignedUrlFromS3.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        controller.streamRecording(recordingId, mockResponse),
      ).rejects.toThrow(NotFoundException);
      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      expect(fileServiceService.getSignedUrlFromS3).toHaveBeenCalledWith(
        dummyS3Key,
      );
    });

    it('should re-throw InternalServerErrorException from getSignedUrlFromS3', async () => {
      recordingService.getRecordingS3Path.mockResolvedValue(dummyS3Key);
      fileServiceService.getSignedUrlFromS3.mockRejectedValue(
        new InternalServerErrorException(),
      );

      await expect(
        controller.streamRecording(recordingId, mockResponse),
      ).rejects.toThrow(InternalServerErrorException);
      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      expect(fileServiceService.getSignedUrlFromS3).toHaveBeenCalledWith(
        dummyS3Key,
      );
    });
  });

  describe('getRecordingPlayback', () => {
    it('returns signed Cloudflare playback URL for Cloudflare-backed recordings', async () => {
      recordingService.getRecordingById.mockResolvedValue({
        id: 'rec_cf_1',
        status: 'ready',
        metadata: {
          provider: 'cloudflare',
          cloudflareStreamUid: 'cf_stream_uid_999',
        },
      } as any);

      const res = await controller.getRecordingPlayback('rec_cf_1');

      expect(res.playable).toBe(true);
      expect(res.playback_id).toBe('cf_stream_uid_999');
      expect(res.mux_public_url).toBe(
        'https://videodelivery.net/cf_stream_uid_999/manifest/video.m3u8',
      );
      expect(res.signed_url).toContain(
        'https://videodelivery.net/signed_cf_jwt_token_123/manifest/video.m3u8',
      );
    });

    it('throws NotFoundException if recording does not exist', async () => {
      recordingService.getRecordingById.mockResolvedValue(null);

      await expect(
        controller.getRecordingPlayback('non_existent_rec'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
