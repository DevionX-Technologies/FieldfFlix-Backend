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
import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { CommonService } from 'src/common/service/common.service';
import { ConfigService } from '@nestjs/config';
import { RecordingService } from './service/recording.service';

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
    } as any;

    fileServiceService = {
      getVideoStream: jest.fn(),
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

      const result = await controller.getRecordingById(recordingId);

      expect(recordingService.getRecordingById).toHaveBeenCalledWith(
        recordingId,
      );
      expect(result).toEqual(expectedRecording);
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
    const dummyVideoStream = Readable.from(['dummy video data']);
    const mockResponse = { set: jest.fn() } as any;

    it('should call services and return a StreamableFile on success', async () => {
      recordingService.getRecordingS3Path.mockResolvedValue(dummyS3Key);
      fileServiceService.getVideoStream.mockResolvedValue(dummyVideoStream);

      const result = await controller.streamRecording(
        recordingId,
        mockResponse,
      );

      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      const expectedBucketName = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;
      expect(fileServiceService.getVideoStream).toHaveBeenCalledWith(
        dummyS3Key,
        expectedBucketName,
      );
      expect(result).toBeInstanceOf(StreamableFile);
      expect(mockResponse.set).toHaveBeenCalledWith({
        'Content-Type': 'video/mp4',
        'Content-Disposition': `inline; filename="recording-${recordingId}.mp4"`,
      });
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
      expect(fileServiceService.getVideoStream).not.toHaveBeenCalled();
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
      expect(fileServiceService.getVideoStream).not.toHaveBeenCalled();
    });

    it('should re-throw NotFoundException from getVideoStream', async () => {
      recordingService.getRecordingS3Path.mockResolvedValue(dummyS3Key);
      fileServiceService.getVideoStream.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        controller.streamRecording(recordingId, mockResponse),
      ).rejects.toThrow(NotFoundException);
      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      const expectedBucketName = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;
      expect(fileServiceService.getVideoStream).toHaveBeenCalledWith(
        dummyS3Key,
        expectedBucketName,
      );
    });

    it('should re-throw InternalServerErrorException from getVideoStream', async () => {
      recordingService.getRecordingS3Path.mockResolvedValue(dummyS3Key);
      fileServiceService.getVideoStream.mockRejectedValue(
        new InternalServerErrorException(),
      );

      await expect(
        controller.streamRecording(recordingId, mockResponse),
      ).rejects.toThrow(InternalServerErrorException);
      expect(recordingService.getRecordingS3Path).toHaveBeenCalledWith(
        recordingId,
      );
      const expectedBucketName = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;
      expect(fileServiceService.getVideoStream).toHaveBeenCalledWith(
        dummyS3Key,
        expectedBucketName,
      );
    });
  });
});
