import { Test, TestingModule } from '@nestjs/testing';
import { MediaUploadService } from './media-upload.service';
import { FileServiceService } from 'src/file-service/file-service.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MediaUploadEntity } from './entities/media-upload.entity';
import { DataSource } from 'typeorm';
import { CommonService } from 'src/common/service/common.service';
import { EMediaUploadType } from './enum/media-upload.enum';
import {
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';

// Mock console.error before all tests
const mockConsoleError = jest
  .spyOn(console, 'error')
  .mockImplementation(() => {});

describe('MediaUploadService', () => {
  let service: MediaUploadService;

  const mockFileService = {
    getSignedUrlFromS3: jest.fn(),
    // Add other fileService methods if needed for other tests
  };

  const mockMediaUploadRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    // Add other repository methods if needed
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn(),
      },
    }),
  };

  const mockCommonService = {
    // Define mocks if needed
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaUploadService,
        { provide: FileServiceService, useValue: mockFileService },
        {
          provide: getRepositoryToken(MediaUploadEntity),
          useValue: mockMediaUploadRepository,
        },
        { provide: DataSource, useValue: mockDataSource },
        { provide: CommonService, useValue: mockCommonService },
      ],
    }).compile();

    service = module.get<MediaUploadService>(MediaUploadService);
    mockConsoleError.mockClear(); // Clear mockConsoleError calls before each test
  });

  afterEach(() => {
    jest.clearAllMocks(); // Clear all other mocks
  });

  afterAll(() => {
    mockConsoleError.mockRestore(); // Restore console.error after all tests
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getVideoStream', () => {
    const mediaId = 'test-media-id';
    const mockMediaEntity = {
      id: mediaId,
      media_upload_type: EMediaUploadType.VIDEO,
      media_url: 'test-key',
      bucket_name: 'test-bucket',
    } as MediaUploadEntity;

    it('should return a presigned URL for a valid mediaId', async () => {
      mockMediaUploadRepository.findOne.mockResolvedValue(mockMediaEntity);
      const expectedUrl = 's3://presigned-url';
      mockFileService.getSignedUrlFromS3.mockResolvedValue(expectedUrl);

      const result = await service.getVideoStream(mediaId);
      expect(result).toBe(expectedUrl);
      expect(mockMediaUploadRepository.findOne).toHaveBeenCalledWith({
        where: { id: mediaId, media_upload_type: EMediaUploadType.VIDEO },
      });
      expect(mockFileService.getSignedUrlFromS3).toHaveBeenCalledWith(
        mockMediaEntity.media_url,
        mockMediaEntity.bucket_name,
      );
    });

    it('should return null if media not found', async () => {
      mockMediaUploadRepository.findOne.mockResolvedValue(null);
      const result = await service.getVideoStream(mediaId);
      expect(result).toBeNull();
    });

    it('should return null and log error if media record is incomplete (missing media_url)', async () => {
      const incompleteEntity = { ...mockMediaEntity, media_url: null };
      mockMediaUploadRepository.findOne.mockResolvedValue(incompleteEntity);
      const result = await service.getVideoStream(mediaId);
      expect(result).toBeNull();
      expect(mockConsoleError).toHaveBeenCalledWith(
        `Media record ${mediaId} is incomplete (missing media_url or bucket_name).`,
      );
    });

    it('should re-throw HttpException if getSignedUrlFromS3 throws it', async () => {
      mockMediaUploadRepository.findOne.mockResolvedValue(mockMediaEntity);
      const s3Error = new BadRequestException('S3 Access Denied');
      mockFileService.getSignedUrlFromS3.mockRejectedValue(s3Error);

      await expect(service.getVideoStream(mediaId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getVideoStream(mediaId)).rejects.toEqual(s3Error);
      expect(mockConsoleError).toHaveBeenCalledWith(
        `Error generating presigned URL for media ${mediaId}: `,
        s3Error,
      );
    });

    it('should throw InternalServerErrorException if getSignedUrlFromS3 throws a non-HttpException', async () => {
      mockMediaUploadRepository.findOne.mockResolvedValue(mockMediaEntity);
      const genericError = new Error('Generic S3 problem');
      mockFileService.getSignedUrlFromS3.mockRejectedValue(genericError);

      await expect(service.getVideoStream(mediaId)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.getVideoStream(mediaId)).rejects.toThrow(
        'Failed to get video URL: Generic S3 problem',
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        `Error generating presigned URL for media ${mediaId}: `,
        genericError,
      );
    });
  });
});
