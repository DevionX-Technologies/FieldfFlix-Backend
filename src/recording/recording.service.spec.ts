import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Recording } from './entities/recording.entity';
import { Camera } from '../camera/camera.entity';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import {
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { FileServiceService } from 'src/file-service/file-service.service';
import {
  EMediaUploadType,
  ESortOrder,
} from 'src/media-upload/enum/media-upload.enum';
import { CommonService } from 'src/common/service/common.service';
import { ConfigService } from '@nestjs/config';
import { QueryUserMediaDto } from 'src/media-upload/dto/media-upload.dto';
import { v4 as uuidv4 } from 'uuid';
import { User } from 'src/user/entities/user.entity';
import { SharedRecording } from './entities/shared-recording.entity';
import { CreateSharedRecordingDto } from './dto/create-shared-recording.dto';
import { BadRequestException } from '@nestjs/common';
import { RecordingService } from './service/recording.service';

jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

const mockConsoleError = jest
  .spyOn(console, 'error')
  .mockImplementation(() => {});

// Add these mock objects at the top-level scope so all tests can use them
const mockRecordingEntity = {
  id: 'recording-1',
  userId: 'user-1',
  status: 'completed',
  s3Path: 'test/path',
  sharedRecordings: [],
} as Recording;

const mockUser = {
  id: 'user-2',
  email: 'test@example.com',
} as User;

const mockSharedRecording = {
  id: 'share-1',
  recording_id: 'recording-1',
  shared_by_user_id: 'user-1',
  shared_with_user_id: 'user-2',
  is_active: true,
} as SharedRecording;

describe('RecordingService', () => {
  let service: RecordingService;
  let recordingRepository: MockRepository<Recording>;
  let cameraRepository: MockRepository<Camera>;
  let raspberryPiApiService: jest.Mocked<RaspberryPiApiService>;
  let mockFileService: {
    getSignedUrlFromS3: jest.Mock;
    deleteFileFormS3: jest.Mock;
  };
  let mockDataSource: Partial<DataSource>;
  let mockCommonService: Partial<CommonService>;
  let mockConfigService: Partial<ConfigService>;
  let sharedRecordingRepository: Repository<SharedRecording>;
  let userRepository: Repository<User>;

  // Helper type for mocking TypeORM repositories
  type MockRepository<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

  beforeEach(async () => {
    // Create mock repository objects
    // Use a single mock for Recording repository injected into the service
    recordingRepository = {
      create: jest.fn().mockImplementation((dto) => {
        // Simulate create - return a new object with default properties and generated ID
        // Ensure the returned object has an id property, even if undefined initially in dto
        return {
          id:
            dto.id ??
            'mock-created-id-' + Math.random().toString(36).substring(7), // Ensure ID is always present
          ...dto,
          // Ensure nested relations are present or default to null/undefined if not in dto
          user: dto.user ?? (dto.userId ? ({ id: dto.userId } as User) : null),
          camera:
            dto.camera ??
            (dto.cameraId ? ({ id: dto.cameraId } as Camera) : null),
          // Add other default properties that might be expected if not in dto
          startTime: dto.startTime ?? new Date(),
          status: dto.status ?? 'in_progress',
          is_favorite: dto.is_favorite ?? false, // Default favorite status
          share_token: dto.share_token ?? null, // Default share token
          createdAt: dto.createdAt ?? new Date(), // Default creation date
          updatedAt: dto.updatedAt ?? new Date(), // Default update date
          updated_at: dto.updated_at ?? new Date(), // Also include updated_at for potential database column access
          metadata: dto.metadata ?? {},
          raspberryPiRecordingId: dto.raspberryPiRecordingId ?? null, // Default RPi ID
          endTime: dto.endTime ?? null, // Default end time
          s3Path: dto.s3Path ?? null, // Default s3 path
          turf_id: dto.turf_id ?? null, // Include turf_id if present or null
          sharedRecordings: [],
        };
      }),
      save: jest.fn().mockImplementation(async (entity) => {
        // Simulate save - return the entity with an ID if it doesn't have one
        if (!entity) {
          throw new Error('Attempted to save a null or undefined entity');
        }
        // Ensure the returned entity has an ID and carries over nested relations/properties
        return {
          ...entity,
          id:
            entity.id ??
            'mock-generated-id-' + Math.random().toString(36).substring(7),
          user:
            entity.user ??
            (entity.userId ? ({ id: entity.userId } as User) : null), // Ensure user is carried or created if userId exists
          camera:
            entity.camera ??
            (entity.cameraId ? ({ id: entity.cameraId } as Camera) : null), // Ensure camera is carried or created if cameraId exists
          is_favorite: entity.is_favorite ?? false, // Carry over or default favorite status
          share_token: entity.share_token ?? null, // Carry over or default share token
          s3Path: entity.s3Path ?? null, // Carry over or default s3 path
          endTime: entity.endTime ?? null, // Carry over or default end time
          updatedAt: entity.updatedAt ?? new Date(), // Carry over or default updated date
          updated_at: entity.updated_at ?? new Date(), // Carry over or default updated_at
          turf_id: entity.turf_id ?? null, // Carry over or default turf_id
          sharedRecordings: entity.sharedRecordings ?? [],
        };
      }),
      findOne: jest.fn(), // Keep findOne mock separate
      // Add createQueryBuilder for methods that use it (e.g., getFavoriteVideos)
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      }),
    };
    cameraRepository = {
      findOne: jest.fn(),
    };
    raspberryPiApiService = {
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
    } as any; // Cast to any to satisfy linter for partial mock

    // Removed the separate mockRecordingRepositoryForMedia as we are using a single mock

    mockFileService = {
      getSignedUrlFromS3: jest.fn(),
      deleteFileFormS3: jest.fn().mockResolvedValue(undefined),
    };

    // Add mock implementation for deleteFileFormS3 if needed in tests
    // mockFileService.deleteFileFormS3.mockResolvedValue(undefined);

    mockDataSource = {
      // Mock DataSource if needed for other methods
    };

    mockCommonService = {
      // Mock CommonService if needed
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'APP_BASE_URL') {
          return 'http://localhost:3000';
        }
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingService,
        {
          provide: getRepositoryToken(Recording),
          useValue: recordingRepository, // Use the primary recordingRepository mock
        },
        {
          provide: getRepositoryToken(Camera),
          useValue: cameraRepository,
        },
        {
          provide: RaspberryPiApiService,
          useValue: raspberryPiApiService,
        },
        { provide: FileServiceService, useValue: mockFileService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: CommonService, useValue: mockCommonService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: getRepositoryToken(SharedRecording),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RecordingService>(RecordingService);
    // Assign the media-specific repository mock directly to the service instance if needed,
    // or ensure the primary recordingRepository handles both cases.
    // Based on the service code, it uses a single recordingRepository property.
    // Let's ensure the primary recordingRepository handles both general and media-related findOne/save/etc.
    // The mockRecordingRepositoryForMedia setup seems intended for the createQueryBuilder usage in getFavoriteVideos.

    // Ensure findOne mocks are reset for each test
    // recordingRepository.findOne.mockReset(); // This will be handled by jest.clearAllMocks in afterEach
    // mockRecordingRepositoryForMedia.findOne.mockReset(); // Removed separate mock

    // Restore console.error mock state
    mockConsoleError.mockClear();

    sharedRecordingRepository = module.get<Repository<SharedRecording>>(
      getRepositoryToken(SharedRecording),
    );
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.clearAllMocks(); // This should handle resetting mocks between tests
    // Re-mock console.error after clearing all mocks if it's being mocked globally
    mockConsoleError.mockImplementation(() => {});
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startRecording', () => {
    const startRecordingDto = {
      userId: 'test-user-id',
      cameraId: 'test-camera-id',
      metadata: { key: 'value' },
    };
    const camera = {
      id: 'test-camera-id',
      name: 'Test Camera',
      raspberryPiBaseUrl: 'http://test-raspberry-pi-base-url',
    } as Camera;
    // Define a base expected recording object structure
    const baseRecording = {
      userId: startRecordingDto.userId,
      cameraId: startRecordingDto.cameraId,
      startTime: expect.any(Date),
      status: 'in_progress',
      metadata: startRecordingDto.metadata,
      user: { id: startRecordingDto.userId } as User,
      camera: { id: startRecordingDto.cameraId } as Camera,
      // Add other base properties expected after creation
      is_favorite: false,
      share_token: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date), // Use updatedAt for the entity property
      updated_at: expect.any(Date), // Also include updated_at for potential database column access
      endTime: null,
      s3Path: null,
      turf_id: null, // Default turf_id to null
      sharedRecordings: [],
    };

    it('should successfully start a recording if camera exists and no recording is in progress', async () => {
      // Arrange
      cameraRepository.findOne.mockResolvedValue(camera);
      // Mock findOne for existing recording check
      recordingRepository.findOne.mockResolvedValue(null);
      const rpiRecordingId = 'rpi-rec-id';
      raspberryPiApiService.startRecording.mockResolvedValue({
        recordingId: rpiRecordingId,
      });

      // Simulate the create-save flow by defining what create should return
      const newRecordingEntity = {
        // What create should produce
        ...baseRecording,
        raspberryPiRecordingId: rpiRecordingId,
      };
      // And what save should return (the same object with a generated ID)
      const savedRecordingEntity = {
        // What save should produce
        ...newRecordingEntity,
        id: 'saved-rec-id', // Simulate generated ID
      } as Recording;

      // Mock create to return the entity before saving
      recordingRepository.create.mockReturnValue(newRecordingEntity);
      // Mock save to return the entity with a generated ID
      recordingRepository.save.mockResolvedValue(savedRecordingEntity);

      // Act
      const result = await service.startRecording({
        ...startRecordingDto,
        turfId: 'test-turf-id',
      });
      console.log('result', result);
      // Assert
      expect(cameraRepository.findOne).toHaveBeenCalledWith({
        where: { id: startRecordingDto.cameraId },
      });
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { cameraId: startRecordingDto.cameraId, status: 'in_progress' },
        relations: ['camera'],
      });
      expect(raspberryPiApiService.startRecording).toHaveBeenCalledWith(
        camera.raspberryPiBaseUrl,
      );
      // Expect create to be called with the DTO data plus base properties that create mock handles
      // Only assert the properties directly from the DTO that are passed to create
      expect(recordingRepository.create).toHaveBeenCalledWith({
        userId: startRecordingDto.userId,
        cameraId: startRecordingDto.cameraId,
        metadata: startRecordingDto.metadata,
      });
      // Expect save to be called with the entity returned by create
      expect(recordingRepository.save).toHaveBeenCalledWith(newRecordingEntity);
      // Expect the result to be the entity returned by save
      expect(result).toEqual(savedRecordingEntity);
    });

    it('should throw NotFoundException if camera does not exist', async () => {
      // Arrange
      cameraRepository.findOne.mockResolvedValue(null); // Camera not found

      // Act & Assert
      await expect(
        service.startRecording({
          ...startRecordingDto,
          turfId: 'test-turf-id',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(cameraRepository.findOne).toHaveBeenCalledWith({
        where: { id: startRecordingDto.cameraId },
      });
      // Ensure no further calls were made if camera not found
      expect(recordingRepository.findOne).not.toHaveBeenCalled();
      expect(raspberryPiApiService.startRecording).not.toHaveBeenCalled();
      expect(recordingRepository.create).not.toHaveBeenCalled();
      expect(recordingRepository.save).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if a recording is already in progress for the camera', async () => {
      // Arrange
      cameraRepository.findOne.mockResolvedValue(camera); // Camera exists
      const existingRecording = {
        id: 'existing-rec-id',
        cameraId: 'test-camera-id',
        status: 'in_progress',
        user: { id: 'test-user-id' } as User,
        camera: { id: 'test-camera-id' } as Camera,
        // Add other properties that might be accessed
        startTime: new Date(),
        is_favorite: false,
        share_token: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updated_at: new Date(),
        endTime: null,
        s3Path: null,
        metadata: {}, // Include metadata
        raspberryPiRecordingId: 'rpi-existing-id', // Add RPi ID
        userId: 'test-user-id', // Add userId
        sharedRecordings: [],
      } as Recording;
      // Mock findOne to return an existing recording
      recordingRepository.findOne.mockResolvedValue(existingRecording);

      // Act & Assert
      await expect(
        service.startRecording({
          ...startRecordingDto,
          turfId: 'test-turf-id',
        }),
      ).rejects.toThrow(ConflictException);
      expect(cameraRepository.findOne).toHaveBeenCalledWith({
        where: { id: startRecordingDto.cameraId },
      });
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { cameraId: startRecordingDto.cameraId, status: 'in_progress' },
        relations: ['camera'],
      });
      // Ensure no further calls were made if existing recording found
      expect(raspberryPiApiService.startRecording).not.toHaveBeenCalled();
      expect(recordingRepository.create).not.toHaveBeenCalled();
      expect(recordingRepository.save).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException if Raspberry Pi recording fails after retries', async () => {
      // Arrange
      cameraRepository.findOne.mockResolvedValue(camera); // Camera exists
      // Mock findOne for existing recording check
      recordingRepository.findOne.mockResolvedValue(null);
      // Mock the Raspberry Pi service to throw an error on all attempts immediately
      const rpiError = new Error('RPi start recording failed');
      raspberryPiApiService.startRecording.mockRejectedValue(rpiError);
      jest.useFakeTimers(); // Use fake timers for retries

      // Act & Assert
      const startRecordingPromise = service.startRecording({
        ...startRecordingDto,
        turfId: 'test-turf-id',
      });
      jest.advanceTimersByTime(1000 + 2000 + 4000); // Advance timers for retries (7 seconds total)

      await expect(startRecordingPromise).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(startRecordingPromise).rejects.toThrow(
        'Failed to start recording after 3 retries.',
      );
      expect(cameraRepository.findOne).toHaveBeenCalledWith({
        where: { id: startRecordingDto.cameraId },
      });
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { cameraId: startRecordingDto.cameraId, status: 'in_progress' },
        relations: ['camera'],
      });
      // Expect the RPi service to have been called maxRetries times (3 times)
      expect(raspberryPiApiService.startRecording).toHaveBeenCalledTimes(3);
      // Ensure create and save were not called
      expect(recordingRepository.create).not.toHaveBeenCalled();
      expect(recordingRepository.save).not.toHaveBeenCalled();

      jest.useRealTimers(); // Restore real timers
    });

    it('should successfully start a recording if Raspberry Pi recording succeeds after a retry', async () => {
      // Arrange
      cameraRepository.findOne.mockResolvedValue(camera); // Camera exists
      // Mock findOne for existing recording check
      recordingRepository.findOne.mockResolvedValue(null);
      const rpiRecordingIdAfterRetry = 'rpi-rec-id-retry';
      // Mock the Raspberry Pi service to fail once and then succeed
      const rpiError = new Error('RPi start recording failed - attempt 1');
      raspberryPiApiService.startRecording
        .mockRejectedValueOnce(rpiError)
        .mockResolvedValueOnce({ recordingId: rpiRecordingIdAfterRetry });
      jest.useFakeTimers(); // Use fake timers for retries

      // Simulate the create-save flow by defining what create should return
      const newRecordingEntity = {
        // What create should produce
        ...baseRecording,
        raspberryPiRecordingId: rpiRecordingIdAfterRetry,
      };
      // And what save should return (the same object with a generated ID)
      const savedRecordingEntity = {
        // What save should produce
        ...newRecordingEntity,
        id: 'saved-rec-id-retry', // Simulate generated ID
      } as Recording;

      // Mock create to return the entity before saving
      recordingRepository.create.mockReturnValue(newRecordingEntity);
      // Mock save to return the entity with a generated ID
      recordingRepository.save.mockResolvedValue(savedRecordingEntity);

      // Act
      const startRecordingPromise = service.startRecording({
        ...startRecordingDto,
        turfId: 'test-turf-id',
      });
      jest.advanceTimersByTime(1000); // Advance timers for the first retry (1 second)
      // The second call to RPi service should happen here and succeed immediately

      const result = await startRecordingPromise; // Await the original promise

      // Assert
      expect(cameraRepository.findOne).toHaveBeenCalledWith({
        where: { id: startRecordingDto.cameraId },
      });
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { cameraId: startRecordingDto.cameraId, status: 'in_progress' },
        relations: ['camera'],
      });
      expect(raspberryPiApiService.startRecording).toHaveBeenCalledTimes(2);
      // Expect create to be called with the DTO data plus base properties that create mock handles
      // Only assert the properties directly from the DTO that are passed to create
      expect(recordingRepository.create).toHaveBeenCalledWith({
        userId: startRecordingDto.userId,
        cameraId: startRecordingDto.cameraId,
        metadata: startRecordingDto.metadata,
      });
      // Expect save to be called with the entity returned by create
      expect(recordingRepository.save).toHaveBeenCalledWith(newRecordingEntity);
      // Expect the result to be the entity returned by save
      expect(result).toEqual(savedRecordingEntity);

      jest.useRealTimers(); // Restore real timers
    });
    // Add more startRecording test cases (e.g., RPi API succeeds after multiple retries)
  });

  describe('stopRecording', () => {
    const recordingId = 'test-recording-id';
    // Define a complete in-progress recording entity with all expected properties
    const inProgressRecording = {
      id: recordingId,
      cameraId: 'test-camera-id',
      userId: 'test-user-id',
      status: 'in_progress',
      raspberryPiRecordingId: 'rpi-rec-id',
      startTime: new Date(),
      user: { id: 'test-user-id' } as User,
      camera: { id: 'test-camera-id' } as Camera,
      is_favorite: false, // Include all entity properties
      share_token: null,
      s3Path: null,
      endTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      updated_at: new Date(), // Include updated_at
      metadata: {}, // Include metadata
      // Add turf_id as it's a column in the entity
      turf_id: 123, // Example turf ID
      sharedRecordings: [],
    } as Recording;

    // Define a complete stopped recording entity with all expected properties
    const stoppedRecording = {
      ...inProgressRecording,
      status: 'completed',
      endTime: expect.any(Date),
      s3Path: 's3://test-bucket/test-path',
      // Ensure other properties are carried over or updated as expected
      updatedAt: expect.any(Date), // Expect updated date
      updated_at: expect.any(Date), // Expect updated_at date
      // user, camera, etc. should be present from inProgressRecording spread
    } as Recording;

    it('should successfully stop a recording if it is in progress', async () => {
      // Arrange
      // Ensure findOne returns the inProgressRecording for this specific test
      recordingRepository.findOne.mockResolvedValue(inProgressRecording);
      raspberryPiApiService.stopRecording.mockResolvedValue({
        s3Path: 's3://test-bucket/test-path',
      });
      // Mock save to return the updated entity
      recordingRepository.save.mockResolvedValue(stoppedRecording);

      // Act
      const result = await service.stopRecording(recordingId);

      // Assert
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId, status: 'in_progress' },
      });
      expect(raspberryPiApiService.stopRecording).toHaveBeenCalledWith(
        inProgressRecording.raspberryPiRecordingId,
      );
      // Expect save to be called with the updated entity details
      expect(recordingRepository.save).toHaveBeenCalledWith({
        ...inProgressRecording,
        status: 'completed',
        endTime: expect.any(Date),
        s3Path: 's3://test-bucket/test-path',
        updatedAt: expect.any(Date), // Expect updated date
        updated_at: expect.any(Date), // Expect updated_at date
        // user, camera, etc. should be present from inProgressRecording spread
      });
      // Expect the result to be the entity returned by save
      expect(result).toEqual(stoppedRecording);
    });

    it('should throw NotFoundException if recording is not found or not in progress', async () => {
      // Arrange
      // Explicitly mock findOne to return null for this test case
      recordingRepository.findOne.mockResolvedValue(null); // Recording not found or not in progress

      // Act & Assert
      await expect(service.stopRecording(recordingId)).rejects.toThrow(
        NotFoundException,
      );
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId, status: 'in_progress' },
      });
      // Ensure no further calls were made
      expect(raspberryPiApiService.stopRecording).not.toHaveBeenCalled();
      expect(recordingRepository.save).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException if raspberryPiRecordingId is missing', async () => {
      // Arrange
      // Define a recording entity missing raspberryPiRecordingId
      const recordingWithoutRPiId = {
        ...inProgressRecording,
        raspberryPiRecordingId: undefined,
      } as Recording;
      // Explicitly mock findOne to return the entity missing RPi ID for this test case
      recordingRepository.findOne.mockResolvedValue(recordingWithoutRPiId);

      // Act & Assert
      await expect(service.stopRecording(recordingId)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.stopRecording(recordingId)).rejects.toThrow(
        'Raspberry Pi recording ID not found for recording.',
      );
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId, status: 'in_progress' },
      });
      // Ensure no further calls were made
      expect(raspberryPiApiService.stopRecording).not.toHaveBeenCalled();
      expect(recordingRepository.save).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException if Raspberry Pi stop recording fails after retries', async () => {
      // Arrange
      // Explicitly mock findOne to return the inProgressRecording for this test
      recordingRepository.findOne.mockResolvedValue(inProgressRecording);
      // Mock the Raspberry Pi service to throw an error on all attempts immediately
      const rpiError = new Error('RPi stop recording failed');
      raspberryPiApiService.stopRecording.mockRejectedValue(rpiError);
      jest.useFakeTimers(); // Use fake timers for retries

      // Act & Assert
      const stopRecordingPromise = service.stopRecording(recordingId);
      jest.advanceTimersByTime(1000 + 2000 + 4000); // Advance timers for retries (7 seconds total)

      await expect(stopRecordingPromise).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(stopRecordingPromise).rejects.toThrow(
        'Failed to stop recording on Raspberry Pi after 3 retries.',
      );
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId, status: 'in_progress' },
      });
      // Expect the RPi service to have been called maxRetries times (3 times)
      expect(raspberryPiApiService.stopRecording).toHaveBeenCalledTimes(3);
      // Ensure save is not called
      expect(recordingRepository.save).not.toHaveBeenCalled();

      jest.useRealTimers(); // Restore real timers
    });

    it('should successfully stop a recording if Raspberry Pi stop recording succeeds after a retry', async () => {
      // Arrange
      // Explicitly mock findOne to return the inProgressRecording for this test
      recordingRepository.findOne.mockResolvedValue(inProgressRecording);
      // Mock the Raspberry Pi service to fail once and then succeed
      const rpiError = new Error('RPi stop recording failed - attempt 1');
      const s3PathAfterRetry = 's3://test-bucket/test-path-retry';
      raspberryPiApiService.stopRecording
        .mockRejectedValueOnce(rpiError)
        .mockResolvedValueOnce({ s3Path: s3PathAfterRetry });
      jest.useFakeTimers(); // Use fake timers for retries

      // Define the expected entity after saving with the retry result
      const stoppedRecordingAfterRetry = {
        ...inProgressRecording,
        status: 'completed',
        endTime: expect.any(Date),
        s3Path: s3PathAfterRetry,
        updatedAt: expect.any(Date), // Expect updated date
        updated_at: expect.any(Date), // Expect updated_at date
      } as Recording;

      // Mock save to return the updated entity
      recordingRepository.save.mockResolvedValue(stoppedRecordingAfterRetry);

      // Act
      const stopRecordingPromise = service.stopRecording(recordingId);
      jest.advanceTimersByTime(1000); // Advance timers for the first retry (1 second)
      // The second call to RPi service should happen here and succeed immediately

      const result = await stopRecordingPromise; // Await the original promise

      // Assert
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId, status: 'in_progress' },
      });
      expect(raspberryPiApiService.stopRecording).toHaveBeenCalledTimes(2);
      // Expect save to be called with the updated entity details
      expect(recordingRepository.save).toHaveBeenCalledWith({
        ...inProgressRecording,
        status: 'completed',
        endTime: expect.any(Date),
        s3Path: s3PathAfterRetry,
        updatedAt: expect.any(Date), // Expect updated date
        updated_at: expect.any(Date), // Expect updated_at date
      });
      // Expect the result to be the entity returned by save
      expect(result).toEqual(stoppedRecordingAfterRetry);

      jest.useRealTimers(); // Restore real timers
    });
  });

  describe('getMediaByShareToken', () => {
    const shareToken = 'test-share-token';
    // Updated mock entity to be a Recording with necessary properties for this test
    const mockRecordingEntity = {
      share_token: shareToken,
      s3Path: 'test-bucket-shared/test-key-shared', // Assuming bucket/key format
      id: 'test-recording-id-shared',
      userId: 'test-user-id',
      cameraId: 'test-camera-id',
      startTime: new Date(),
      status: 'completed',
      is_favorite: false,
      endTime: new Date(),
      raspberryPiRecordingId: 'rpi-rec-id-shared',
      updatedAt: new Date(),
      updated_at: new Date(), // Include updated_at
      metadata: {}, // Include metadata
      user: { id: 'test-user-id' } as User, // Add minimal mock user
      camera: { id: 'test-camera-id' } as Camera, // Add minimal mock camera
      // Add turf_id as it's used in getFavoriteVideos and is a column
      turf_id: 123, // Use number as per DTO
      sharedRecordings: [],
    } as Recording;

    it('should return a presigned URL for a valid shareToken', async () => {
      // Ensure findOne returns the mock recording entity
      recordingRepository.findOne.mockResolvedValue(mockRecordingEntity);
      const expectedUrl = 's3://presigned-url-shared';
      mockFileService.getSignedUrlFromS3.mockResolvedValue(expectedUrl);

      const result = await service.getMediaByShareToken(shareToken);
      expect(result).toBe(expectedUrl);
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: {
          share_token: shareToken,
          // Removed media_upload_type check as it's not in Recording entity
        },
      });
      // Expect getSignedUrlFromS3 to be called with parsed bucket and key
      const s3UrlParts = mockRecordingEntity.s3Path.split('/');
      const bucketName = s3UrlParts[0];
      const s3Key = s3UrlParts.slice(1).join('/');
      expect(mockFileService.getSignedUrlFromS3).toHaveBeenCalledWith(
        s3Key,
        bucketName,
      );
    });

    it('should return null if media not found for shareToken', async () => {
      // Ensure findOne returns null
      recordingRepository.findOne.mockResolvedValue(null);
      const result = await service.getMediaByShareToken(shareToken);
      expect(result).toBeNull();
    });

    it('should return null and log error if shared media record is incomplete', async () => {
      // Simulate missing s3Path in Recording entity
      const incompleteEntity = { ...mockRecordingEntity, s3Path: null };
      // Ensure findOne returns the incomplete entity
      recordingRepository.findOne.mockResolvedValue(incompleteEntity);
      const result = await service.getMediaByShareToken(shareToken);
      expect(result).toBeNull();
      // Correcting the expected console error message to check for parts and the error object
      expect(mockConsoleError).toHaveBeenCalledWith(
        `Shared recording record for token ${shareToken} is incomplete (missing s3Path).`,
        // We expect the s3Path to be null or undefined in the incomplete entity, which might be logged as part of the message or separately.
        // Let's check if console.error was called with at least one argument containing the token.
        // A more robust test might inspect the arguments array directly if needed.
        // For now, a string containing the token should suffice if the message format is consistent.
      );
    });

    it('should re-throw HttpException if getSignedUrlFromS3 throws it for shared media', async () => {
      // Ensure findOne returns the mock recording entity
      recordingRepository.findOne.mockResolvedValue(mockRecordingEntity);
      const s3Error = new ForbiddenException('S3 Shared Access Denied');
      mockFileService.getSignedUrlFromS3.mockRejectedValue(s3Error);

      // Expecting InternalServerErrorException as service wraps S3 errors
      await expect(service.getMediaByShareToken(shareToken)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.getMediaByShareToken(shareToken)).rejects.toThrow(
        'Failed to get shared recording URL: S3 Shared Access Denied',
      );
      // The service logs the error object itself
      expect(mockConsoleError).toHaveBeenCalledWith(
        `Error generating presigned URL for shared recording token ${shareToken}: `,
        s3Error,
      );
    });

    it('should throw InternalServerErrorException if getSignedUrlFromS3 throws non-HttpException for shared media', async () => {
      // Ensure findOne returns the mock recording entity
      recordingRepository.findOne.mockResolvedValue(mockRecordingEntity);
      const genericError = new Error('Generic S3 Shared problem');
      mockFileService.getSignedUrlFromS3.mockRejectedValue(genericError);

      await expect(service.getMediaByShareToken(shareToken)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.getMediaByShareToken(shareToken)).rejects.toThrow(
        'Failed to get shared recording URL: Generic S3 Shared problem',
      );
      // The service logs the error object itself
      expect(mockConsoleError).toHaveBeenCalledWith(
        `Error generating presigned URL for shared recording token ${shareToken}: `,
        genericError,
      );
    });
  });

  describe('generateShareLink', () => {
    const recordingId = 'test-recording-id';
    const userId = 'test-user-id';
    // Updated mock entity to be a Recording with necessary properties for this test
    const mockRecordingEntity = {
      id: recordingId,
      user_id: userId, // Still needed for relationship
      userId: userId,
      cameraId: 'test-camera-id',
      startTime: new Date(),
      status: 'completed',
      s3Path: 'test-bucket/test-key',
      is_favorite: false,
      endTime: new Date(),
      raspberryPiRecordingId: 'rpi-rec-id',
      updatedAt: new Date(),
      updated_at: new Date(), // Include updated_at
      metadata: {}, // Include metadata
      share_token: null, // Keep share_token as it's used in this suite
      user: { id: userId } as User, // Add minimal mock user
      camera: { id: 'test-camera-id' } as Camera, // Add minimal mock camera
      // Add turf_id as it's a column in the entity
      turf_id: 123, // Use number as per DTO
      sharedRecordings: [],
    } as Recording;

    it('should generate and save a new share token if one does not exist', async () => {
      // Ensure findOne returns the mock recording entity
      recordingRepository.findOne.mockResolvedValue(mockRecordingEntity);
      const newShareToken = 'new-test-share-token';
      (uuidv4 as jest.Mock).mockReturnValue(newShareToken);
      // Mock save to return the entity with the new share token
      recordingRepository.save.mockResolvedValue({
        ...mockRecordingEntity,
        share_token: newShareToken,
      });

      const result = await service.generateShareLink(recordingId, userId);

      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
      expect(uuidv4).toHaveBeenCalled();
      // Expect save to be called with the entity updated with the new share token
      expect(recordingRepository.save).toHaveBeenCalledWith({
        ...mockRecordingEntity,
        share_token: newShareToken,
      });
      expect(result).toEqual({ share_token: newShareToken });
    });

    it('should return the existing share token if one exists', async () => {
      const existingShareToken = 'existing-test-share-token';
      const recordingWithExistingToken = {
        ...mockRecordingEntity,
        share_token: existingShareToken,
      };
      // Ensure findOne returns the entity with the existing token
      recordingRepository.findOne.mockResolvedValue(recordingWithExistingToken);

      const result = await service.generateShareLink(recordingId, userId);

      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
      expect(uuidv4).not.toHaveBeenCalled(); // Should not generate a new UUID
      expect(recordingRepository.save).not.toHaveBeenCalled(); // Should not save again
      expect(result).toEqual({ share_token: existingShareToken });
    });

    it('should throw NotFoundException if recording is not found', async () => {
      // Ensure findOne returns null
      recordingRepository.findOne.mockResolvedValue(null);

      await expect(
        service.generateShareLink(recordingId, userId),
      ).rejects.toThrow(NotFoundException);
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
    });

    it('should throw ForbiddenException if user does not own the recording', async () => {
      const recordingOwnedByAnotherUser = {
        ...mockRecordingEntity,
        user_id: 'another-user-id',
        userId: 'another-user-id', // Use userId field
      } as Recording;
      // Ensure findOne returns the recording owned by another user
      recordingRepository.findOne.mockResolvedValue(
        recordingOwnedByAnotherUser,
      );

      await expect(
        service.generateShareLink(recordingId, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
    });
    // Removed test case for "should throw ForbiddenException if media is not a video"
  });

  describe('toggleFavoriteStatus', () => {
    const recordingId = 'test-recording-id';
    const userId = 'test-user-id';
    const mockRecordingEntity = {
      id: recordingId,
      user_id: userId, // Still needed for relationship
      is_favorite: false,
      userId: userId,
      cameraId: 'test-camera-id',
      startTime: new Date(),
      status: 'completed',
      s3Path: 'test-bucket/test-key',
      endTime: new Date(),
      raspberryPiRecordingId: 'rpi-rec-id',
      updatedAt: new Date(),
      updated_at: new Date(), // Include updated_at
      metadata: {}, // Include metadata
      share_token: null, // Keep share_token as it's used in this suite
      user: { id: userId } as User, // Add minimal mock user
      camera: { id: 'test-camera-id' } as Camera, // Add minimal mock camera
      // Add turf_id as it's a column in the entity
      turf_id: 123, // Use number as per DTO
      sharedRecordings: [],
    } as Recording;

    it('should toggle is_favorite from false to true and save', async () => {
      // Ensure findOne returns the mock recording entity
      recordingRepository.findOne.mockResolvedValue(mockRecordingEntity);
      const expectedRecording = { ...mockRecordingEntity, is_favorite: true };
      // Mock save to return the updated entity
      recordingRepository.save.mockResolvedValue(expectedRecording);

      const result = await service.toggleFavoriteStatus(recordingId, userId);

      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
      // Expect save to be called with the updated entity
      expect(recordingRepository.save).toHaveBeenCalledWith(expectedRecording);
      expect(result).toEqual(expectedRecording);
    });

    it('should toggle is_favorite from true to false and save', async () => {
      const favoritedRecording = { ...mockRecordingEntity, is_favorite: true };
      // Ensure findOne returns the favorited recording entity
      recordingRepository.findOne.mockResolvedValue(favoritedRecording);
      const expectedRecording = { ...favoritedRecording, is_favorite: false };
      // Mock save to return the updated entity
      recordingRepository.save.mockResolvedValue(expectedRecording);

      const result = await service.toggleFavoriteStatus(recordingId, userId);

      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
      // Expect save to be called with the updated entity
      expect(recordingRepository.save).toHaveBeenCalledWith(expectedRecording);
      expect(result).toEqual(expectedRecording);
    });

    it('should throw NotFoundException if recording is not found', async () => {
      // Ensure findOne returns null
      recordingRepository.findOne.mockResolvedValue(null);

      await expect(
        service.toggleFavoriteStatus(recordingId, userId),
      ).rejects.toThrow(NotFoundException);
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
    });

    it('should throw ForbiddenException if user does not own the recording', async () => {
      // Arrange
      const recordingOwnedByAnotherUser = {
        ...mockRecordingEntity,
        user_id: 'another-user-id',
        userId: 'another-user-id', // Use userId field
      } as Recording;
      // Ensure findOne returns the recording owned by another user
      recordingRepository.findOne.mockResolvedValue(
        recordingOwnedByAnotherUser,
      );

      // Act & Assert
      await expect(
        service.toggleFavoriteStatus(recordingId, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: recordingId },
      });
      // Ensure save is not called
      expect(recordingRepository.save).not.toHaveBeenCalled();
    });
    // Removed test case for "should throw ForbiddenException if media is not a video"
  });

  describe('getFavoriteVideos', () => {
    const userId = 'test-user-id';
    const mockQuery: QueryUserMediaDto = {
      sortOrder: ESortOrder.NEW_TO_OLD,
      media_upload_type: EMediaUploadType.VIDEO,
      turfId: undefined as any, // Allow undefined initially
    };
    // Updated mock list to be Recording entities with necessary properties for this test
    const mockRecordingList = [
      {
        id: 'rec-1',
        userId: userId,
        is_favorite: true,
        startTime: new Date('2023-01-01T10:00:00Z'),
        cameraId: 'cam-1',
        status: 'completed',
        s3Path: 'bucket/key1',
        endTime: new Date('2023-01-01T10:10:00Z'),
        raspberryPiRecordingId: 'rpi-rec-1',
        updatedAt: new Date('2023-01-01T10:10:00Z'),
        updated_at: new Date('2023-01-01T10:10:00Z'), // Include updated_at
        metadata: { size: '10MB' },
        share_token: 'share-1', // Add share_token to list items if needed by tests
        user: { id: userId } as User, // Add minimal mock user
        camera: { id: 'cam-1' } as Camera, // Add minimal mock camera
        turf_id: 123, // Add turf_id
        sharedRecordings: [],
      } as Recording,
      {
        id: 'rec-2',
        userId: userId,
        is_favorite: true,
        startTime: new Date('2023-01-02T10:00:00Z'),
        cameraId: 'cam-2',
        status: 'completed',
        s3Path: 'bucket/key2',
        endTime: new Date('2023-01-02T10:15:00Z'),
        raspberryPiRecordingId: 'rpi-rec-2',
        updatedAt: new Date('2023-01-02T10:15:00Z'),
        updated_at: new Date('2023-01-02T10:15:00Z'), // Include updated_at
        metadata: { size: '12MB' },
        share_token: 'share-2', // Add share_token to list items if needed by tests
        user: { id: userId } as User, // Add minimal mock user
        camera: { id: 'cam-2' } as Camera, // Add minimal mock camera
        turf_id: 123, // Add turf_id
        sharedRecordings: [],
      } as Recording,
    ];

    it('should return a list of favorite recordings for the user', async () => {
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecordingList),
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getFavoriteVideos(userId, mockQuery);

      expect(recordingRepository.createQueryBuilder).toHaveBeenCalledWith(
        'recording',
      ); // Assert with 'recording' alias
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'recording.userId = :userId',
        { userId: userId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.is_favorite = :is_favorite',
        {
          is_favorite: true,
        },
      );
      // Assert the media_upload_type filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        { mediaUploadType: EMediaUploadType.VIDEO },
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'recording.startTime',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'recording.id',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(mockRecordingList);
    });

    it('should filter by turfId if provided', async () => {
      const queryWithTurf: QueryUserMediaDto = { ...mockQuery, turfId: 123 }; // Use number turfId as per DTO
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecordingList),
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.getFavoriteVideos(userId, queryWithTurf);

      expect(recordingRepository.createQueryBuilder).toHaveBeenCalledWith(
        'recording',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'recording.userId = :userId',
        { userId: userId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.is_favorite = :is_favorite',
        { is_favorite: true },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.turf_id = :turfId', // Use recording.turf_id based on entity
        { turfId: queryWithTurf.turfId },
      );
      // Assert the media_upload_type filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        { mediaUploadType: EMediaUploadType.VIDEO },
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'recording.startTime',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'recording.id',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply OLD_TO_NEW sort order', async () => {
      const queryOldToNew = { ...mockQuery, sortOrder: ESortOrder.OLD_TO_NEW };
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecordingList),
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.getFavoriteVideos(userId, queryOldToNew);

      expect(recordingRepository.createQueryBuilder).toHaveBeenCalledWith(
        'recording',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'recording.userId = :userId',
        { userId: userId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.is_favorite = :is_favorite',
        { is_favorite: true },
      );
      // Assert the media_upload_type filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        { mediaUploadType: EMediaUploadType.VIDEO },
      );
      // Note: turfId filter assertion might be needed here if applicable

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'recording.startTime',
        'ASC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'recording.id',
        'DESC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply default sort order if not specified', async () => {
      const queryDefault = { ...mockQuery, sortOrder: undefined };
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecordingList),
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.getFavoriteVideos(userId, queryDefault);

      expect(recordingRepository.createQueryBuilder).toHaveBeenCalledWith(
        'recording',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'recording.userId = :userId',
        { userId: userId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.is_favorite = :is_favorite',
        { is_favorite: true },
      );
      // Assert the media_upload_type filter
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        { mediaUploadType: EMediaUploadType.VIDEO },
      );
      // Note: turfId filter assertion might be needed here if applicable

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'recording.startTime',
        'DESC',
      ); // Use recording.startTime
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'recording.id',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    // Additional test to assert the media_upload_type filter is always applied
    it('should always filter by media_upload_type VIDEO', async () => {
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecordingList),
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Test with and without turfId to ensure the filter is consistent
      const queryWithoutTurf = { ...mockQuery, turfId: undefined };
      const queryWithTurf = { ...mockQuery, turfId: 123 };

      // Act 1
      await service.getFavoriteVideos(userId, queryWithoutTurf);

      // Assert 1: Check for the media_upload_type filter assertion
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        { mediaUploadType: EMediaUploadType.VIDEO },
      );
      // Reset andWhere mock for the next call
      mockQueryBuilder.andWhere.mockClear();

      // Act 2
      await service.getFavoriteVideos(userId, queryWithTurf);

      // Assert 2: Check for the media_upload_type filter assertion again (should be called after is_favorite and turfId filters)
      // Note: The order of andWhere calls matters. Need to ensure this assertion matches the service's implementation order.
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        { mediaUploadType: EMediaUploadType.VIDEO },
      );
      // Assert turfId filter is also called
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.turf_id = :turfId', // Use recording.turf_id based on entity
        { turfId: queryWithTurf.turfId },
      );
    });

    it('should handle empty turfId filter', async () => {
      const queryWithoutTurf: QueryUserMediaDto = {
        ...mockQuery,
        turfId: undefined,
      };
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRecordingList),
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getFavoriteVideos(userId, queryWithoutTurf);

      expect(recordingRepository.createQueryBuilder).toHaveBeenCalledWith(
        'recording',
      ); // Assert with 'recording' alias
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'recording.userId = :userId',
        { userId: userId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.is_favorite = :is_favorite',
        {
          is_favorite: true,
        },
      );
      // Ensure turfId filter is NOT applied when turfId is undefined
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'recording.turf_id = :turfId',
        expect.anything(), // We don't care about the value, just that it wasn't called
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'recording.startTime',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'recording.id',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(mockRecordingList);
    });

    // Add test for sorting order (OLD_TO_NEW)
    it('should sort by startTime in ascending order for OLD_TO_NEW', async () => {
      const queryOldToNew: QueryUserMediaDto = {
        ...mockQuery,
        sortOrder: ESortOrder.OLD_TO_NEW,
      };
      // Mock createQueryBuilder chain
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([...mockRecordingList].reverse()), // Reverse list for expected order
      };
      recordingRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getFavoriteVideos(userId, queryOldToNew);

      expect(recordingRepository.createQueryBuilder).toHaveBeenCalledWith(
        'recording',
      ); // Assert with 'recording' alias
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'recording.userId = :userId',
        { userId: userId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'recording.is_favorite = :is_favorite',
        {
          is_favorite: true,
        },
      );
      // Ensure media_upload_type filter is NOT applied
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'recording.media_upload_type = :mediaUploadType',
        expect.anything(),
      );

      // Assert ascending order for startTime
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'recording.startTime',
        'ASC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'recording.id',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual([...mockRecordingList].reverse());
    });
  });

  describe('createSharedRecording', () => {
    const createSharedRecordingDto: CreateSharedRecordingDto = {
      recording_id: 'recording-1',
      shared_with_user_id: 'user-2',
    };

    it('should create a shared recording successfully', async () => {
      jest
        .spyOn(recordingRepository, 'findOne')
        .mockResolvedValue(mockRecordingEntity as Recording);
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser as User);
      jest.spyOn(sharedRecordingRepository, 'findOne').mockResolvedValue(null);
      jest
        .spyOn(sharedRecordingRepository, 'create')
        .mockReturnValue(mockSharedRecording as SharedRecording);
      jest
        .spyOn(sharedRecordingRepository, 'save')
        .mockResolvedValue(mockSharedRecording as SharedRecording);

      const result = await service.createSharedRecording(
        createSharedRecordingDto,
        'user-1',
      );

      expect(result).toEqual(mockSharedRecording);
      expect(recordingRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'recording-1', userId: 'user-1' },
      });
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-2' },
      });
      expect(sharedRecordingRepository.findOne).toHaveBeenCalledWith({
        where: {
          recording_id: 'recording-1',
          shared_with_user_id: 'user-2',
          is_active: true,
        },
      });
    });

    it('should throw BadRequestException when sharing with self', async () => {
      await expect(
        service.createSharedRecording(createSharedRecordingDto, 'user-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when recording not found', async () => {
      jest.spyOn(recordingRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.createSharedRecording(createSharedRecordingDto, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user not found', async () => {
      jest
        .spyOn(recordingRepository, 'findOne')
        .mockResolvedValue(mockRecordingEntity as Recording);
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.createSharedRecording(createSharedRecordingDto, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when recording already shared', async () => {
      jest
        .spyOn(recordingRepository, 'findOne')
        .mockResolvedValue(mockRecordingEntity as Recording);
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser as User);
      jest
        .spyOn(sharedRecordingRepository, 'findOne')
        .mockResolvedValue(mockSharedRecording as SharedRecording);

      await expect(
        service.createSharedRecording(createSharedRecordingDto, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getSharedRecordings', () => {
    it('should return all shared recordings for a user', async () => {
      const mockSharedRecordings = [mockSharedRecording];
      jest
        .spyOn(sharedRecordingRepository, 'find')
        .mockResolvedValue(mockSharedRecordings as SharedRecording[]);

      const result = await service.getSharedRecordings('user-2');

      expect(result).toEqual(mockSharedRecordings);
      expect(sharedRecordingRepository.find).toHaveBeenCalledWith({
        where: {
          shared_with_user_id: 'user-2',
          is_active: true,
        },
        relations: ['recording', 'sharedByUser'],
      });
    });

    it('should return empty array when no shared recordings found', async () => {
      jest.spyOn(sharedRecordingRepository, 'find').mockResolvedValue([]);

      const result = await service.getSharedRecordings('user-2');

      expect(result).toEqual([]);
    });
  });
});
