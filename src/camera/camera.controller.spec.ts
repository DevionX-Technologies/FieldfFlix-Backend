import { Test, TestingModule } from '@nestjs/testing';
import { CameraController } from './camera.controller';
import { CameraService } from './camera.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { Camera } from './camera.entity';
import { NotFoundException } from '@nestjs/common';

const mockCameraService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('CameraController', () => {
  let controller: CameraController;
  let service: CameraService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CameraController],
      providers: [
        {
          provide: CameraService,
          useValue: mockCameraService,
        },
      ],
    }).compile();

    controller = module.get<CameraController>(CameraController);
    service = module.get<CameraService>(CameraService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a new camera', async () => {
      const createCameraDto: CreateCameraDto = {
        name: 'Test Camera',
        turfId: 'turf-uuid',
      };
      const expectedCamera = { id: 'uuid', ...createCameraDto } as Camera;
      mockCameraService.create.mockResolvedValue(expectedCamera);

      const result = await controller.create(createCameraDto);

      expect(service.create).toHaveBeenCalledWith(createCameraDto);
      expect(result).toEqual(expectedCamera);
    });
  });

  describe('findAll', () => {
    it('should return a paginated list of cameras with default params', async () => {
      const cameras: Camera[] = [
        { id: 'uuid1', name: 'Camera 1', turfId: 'turf1', turf: null },
      ];
      const paginationResult = { data: cameras, total: 1 };
      mockCameraService.findAll.mockResolvedValue(paginationResult);

      const result = await controller.findAll(1, 10);

      expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
      expect(result).toEqual(paginationResult);
    });

    it('should return a paginated list of cameras with specified params', async () => {
      const cameras: Camera[] = [
        { id: 'uuid2', name: 'Camera 2', turfId: 'turf2', turf: null },
      ];
      const paginationResult = { data: cameras, total: 1 };
      mockCameraService.findAll.mockResolvedValue(paginationResult);

      const result = await controller.findAll(2, 5);

      expect(service.findAll).toHaveBeenCalledWith({ page: 2, limit: 5 });
      expect(result).toEqual(paginationResult);
    });
  });

  describe('findOne', () => {
    it('should return a camera if found', async () => {
      const camera: Camera = {
        id: 'uuid',
        name: 'Test Camera',
        turfId: 'turf-uuid',
        turf: null,
      };
      mockCameraService.findOne.mockResolvedValue(camera);

      const result = await controller.findOne('uuid');

      expect(service.findOne).toHaveBeenCalledWith('uuid');
      expect(result).toEqual(camera);
    });

    it('should throw NotFoundException if camera not found', async () => {
      mockCameraService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('non-existent-uuid')).rejects.toThrow(
        NotFoundException,
      );
      expect(service.findOne).toHaveBeenCalledWith('non-existent-uuid');
    });
  });

  describe('update', () => {
    it('should update a camera', async () => {
      const updateCameraDto: UpdateCameraDto = { name: 'Updated Camera' };
      mockCameraService.update.mockResolvedValue(undefined);

      await controller.update('uuid', updateCameraDto);

      expect(service.update).toHaveBeenCalledWith('uuid', updateCameraDto);
    });
  });

  describe('remove', () => {
    it('should remove a camera', async () => {
      mockCameraService.remove.mockResolvedValue(undefined);

      await controller.remove('uuid');

      expect(service.remove).toHaveBeenCalledWith('uuid');
    });
  });
});
