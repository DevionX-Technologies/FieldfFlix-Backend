import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationEntity } from './entities/notification.entity';
import { CommonService } from 'src/common/service/common.service';

describe('NotificationService', () => {
  let service: NotificationService;

  const mockNotificationRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    // Add other methods used by NotificationService
  };

  const mockCommonService = {
    // Mock methods of CommonService if they are used by NotificationService
    // e.g., extractDataFromToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: mockNotificationRepository,
        },
        {
          provide: CommonService,
          useValue: mockCommonService,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Example: Add a basic test for a method if one exists
  // describe('createNotification', () => {
  //   it('should create and save a notification', async () => {
  //     const createDto = { message: 'Test notification', userId: 'user1' };
  //     const savedEntity = { id: '1', ...createDto, read: false, createdAt: new Date() };
  //     mockNotificationRepository.create.mockReturnValue(createDto); // or the entity without id/timestamps
  //     mockNotificationRepository.save.mockResolvedValue(savedEntity);

  //     const result = await service.createNotification(createDto as any); // Adjust DTO type as needed
  //     expect(result).toEqual(savedEntity);
  //     expect(mockNotificationRepository.create).toHaveBeenCalledWith(createDto);
  //     expect(mockNotificationRepository.save).toHaveBeenCalledWith(createDto); // or whatever create returns
  //   });
  // });
});
