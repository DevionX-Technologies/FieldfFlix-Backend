import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Camera } from './camera.entity';
import { CreateCameraDto } from './dto/create-camera.dto';

interface PaginationResult<T> {
  data: T[];
  total: number;
}

interface PaginationParams {
  page?: number;
  limit?: number;
  turfId?: string;
}

/**
 * Service for managing Camera entities.
 */
@Injectable()
export class CameraService {
  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
  ) {}

  /**
   * Creates a new camera.
   * @param createCameraDto - The data for creating the camera.
   * @returns The created camera entity.
   */
  async create(createCameraDto: CreateCameraDto): Promise<Camera> {
    const camera: Camera = this.cameraRepository.create(createCameraDto);
    return this.cameraRepository.save(camera) as Promise<Camera>;
  }

  /**
   * Finds all cameras with pagination.
   * @param params - Pagination parameters (page, limit, and optional turfId).
   * @returns A promise that resolves to a paginated list of camera entities.
   */
  async findAll(params: PaginationParams): Promise<PaginationResult<Camera>> {
    const { page = 1, limit = 10, turfId } = params;
    
    const whereCondition = turfId ? { turfId } : {};

    const [data, total] = await this.cameraRepository.findAndCount({
      where: whereCondition,
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  /**
   * Finds a single camera by ID.
   * @param id - The ID of the camera to find.
   * @returns A promise that resolves to the camera entity.
   * @throws NotFoundException if the camera with the given ID is not found.
   */
  async findOne(id: string): Promise<Camera> {
    const camera = await this.cameraRepository.findOne({ where: { id } });
    if (!camera) {
      throw new NotFoundException(`Camera with ID ${id} not found`);
    }
    return camera;
  }

  /**
   * Updates a camera by ID.
   * @param id - The ID of the camera to update.
   * @param updateCameraDto - The data for updating the camera.
   * @returns A promise that resolves when the update is complete.
   */
  async update(id: string, updateCameraDto: any): Promise<void> {
    await this.cameraRepository.update(id, updateCameraDto);
  }

  /**
   * Removes a camera by ID.
   * @param id - The ID of the camera to remove.
   * @returns A promise that resolves when the removal is complete.
   */
  async remove(id: string): Promise<void> {
    await this.cameraRepository.delete(id);
  }
}
