import { Test, TestingModule } from '@nestjs/testing';
import { CameraService } from './camera.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Camera } from './camera.entity';
import { NotFoundException } from '@nestjs/common';
import { CreateCameraDto } from './dto/create-camera.dto';

const mockCameraRepository = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findAndCount: jest.fn(),
};

describe('CameraService', () => {
  let service: CameraService;
  let repository: Repository<Camera>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CameraService,
        {
          provide: getRepositoryToken(Camera),
          useValue: mockCameraRepository,
        },
      ],
    }).compile();

    service = module.get<CameraService>(CameraService);
    repository = module.get<Repository<Camera>>(getRepositoryToken(Camera));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new camera', async () => {
      const createCameraDto: CreateCameraDto = {
        name: 'Test Camera',
        turfId: 'turf-uuid',
      };
      const expectedCamera = { id: 'uuid', ...createCameraDto };

      mockCameraRepository.create.mockReturnValue(createCameraDto);
      mockCameraRepository.save.mockResolvedValue(expectedCamera);

      const result = await service.create(createCameraDto);

      expect(repository.create).toHaveBeenCalledWith(createCameraDto);
      expect(repository.save).toHaveBeenCalledWith(createCameraDto);
      expect(result).toEqual(expectedCamera);
    });
  });

  describe('findAll', () => {
    it('should return an array of cameras with default pagination', async () => {
      const cameras: Camera[] = [
        { id: 'uuid1', name: 'Camera 1', turfId: 'turf1', turf: null },
        { id: 'uuid2', name: 'Camera 2', turfId: 'turf1', turf: null },
      ];
      const total = cameras.length;
      mockCameraRepository.findAndCount.mockResolvedValue([cameras, total]);

      const result = await service.findAll({});

      expect(repository.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
      });
      expect(result).toEqual({ data: cameras, total });
    });

    it('should return an array of cameras with specified pagination', async () => {
      const cameras: Camera[] = [
        { id: 'uuid3', name: 'Camera 3', turfId: 'turf2', turf: null },
      ];
      const total = cameras.length;
      const paginationParams = { page: 2, limit: 5 };
      mockCameraRepository.findAndCount.mockResolvedValue([cameras, total]);

      const result = await service.findAll(paginationParams);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        skip: (paginationParams.page - 1) * paginationParams.limit,
        take: paginationParams.limit,
      });
      expect(result).toEqual({ data: cameras, total });
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
      mockCameraRepository.findOne.mockResolvedValue(camera);

      const result = await service.findOne('uuid');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid' },
      });
      expect(result).toEqual(camera);
    });

    it('should throw NotFoundException if camera not found', async () => {
      mockCameraRepository.findOne.mockResolvedValue(undefined);

      await expect(service.findOne('non-existent-uuid')).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-uuid' },
      });
    });
  });

  describe('update', () => {
    it('should update a camera', async () => {
      const updateCameraDto = { name: 'Updated Camera' };
      mockCameraRepository.update.mockResolvedValue({ affected: 1 });

      await service.update('uuid', updateCameraDto);

      expect(repository.update).toHaveBeenCalledWith('uuid', updateCameraDto);
    });
  });

  describe('remove', () => {
    it('should remove a camera', async () => {
      mockCameraRepository.delete.mockResolvedValue({ affected: 1 });

      await service.remove('uuid');

      expect(repository.delete).toHaveBeenCalledWith('uuid');
    });
  });
});
