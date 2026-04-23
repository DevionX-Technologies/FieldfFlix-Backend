import { Test, TestingModule } from '@nestjs/testing';
import { MediaUploadController } from './media-upload.controller';
import { MediaUploadService } from './media-upload.service';
import { CommonService } from 'src/common/service/common.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

describe('MediaUploadController', () => {
  let controller: MediaUploadController;

  const mockMediaUploadService = {
    getVideoStream: jest.fn(),
    getMediaByShareToken: jest.fn(),
    // Add other methods if needed for other tests, with jest.fn()
  };

  const mockCommonService = {
    // Define mocks if needed
  };

  const mockConfigService = {
    // Define mocks if needed
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaUploadController],
      providers: [
        { provide: MediaUploadService, useValue: mockMediaUploadService },
        { provide: CommonService, useValue: mockCommonService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<MediaUploadController>(MediaUploadController);
  });

  afterEach(() => {
    jest.clearAllMocks(); // Clear mocks after each test
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('streamVideo', () => {
    it('should return a presigned URL when a valid mediaId is provided', async () => {
      const mediaId = 'valid-media-id';
      const expectedUrl = 'https://s3.example.com/presigned-url-for-video';
      mockMediaUploadService.getVideoStream.mockResolvedValue(expectedUrl);

      const result = await controller.streamVideo(mediaId);

      expect(mockMediaUploadService.getVideoStream).toHaveBeenCalledWith(
        mediaId,
      );
      expect(result).toEqual({ presignedUrl: expectedUrl });
    });

    it('should throw NotFoundException when mediaId is not found', async () => {
      const mediaId = 'invalid-media-id';
      mockMediaUploadService.getVideoStream.mockResolvedValue(null);

      await expect(controller.streamVideo(mediaId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockMediaUploadService.getVideoStream).toHaveBeenCalledWith(
        mediaId,
      );
    });
  });

  describe('uploadFile', () => {
    // ... existing code ...
  });

  describe('streamMedia', () => {
    // ... existing code ...
  });
});
