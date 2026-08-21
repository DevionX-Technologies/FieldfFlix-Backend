import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Camera } from './camera.entity';
import { CreateCameraDto } from './dto/create-camera.dto';
import { resolveLegacyQrCameraId } from './camera-legacy-qr.util';
import { TurfEntity } from '../turfs/entities/turfs.entity';

interface PaginationResult<T> {
  data: T[];
  total: number;
}

interface PaginationParams {
  page?: number;
  limit?: number;
  turfId?: string;
  /** When true (default), omit courts hidden from the athlete app. */
  appVisibleOnly?: boolean;
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
    const { page = 1, limit = 10, turfId, appVisibleOnly = true } = params;

    if (appVisibleOnly) {
      const qb = this.cameraRepository
        .createQueryBuilder('camera')
        .leftJoin('camera.turf', 'turf')
        .where('camera.hidden_from_app = :cameraHidden', {
          cameraHidden: false,
        })
        .andWhere('(turf.hidden_from_app = false OR turf.id IS NULL)');

      if (turfId) {
        qb.andWhere('camera.turfId = :turfId', { turfId });
      }

      qb.skip((page - 1) * limit).take(limit);

      const [data, total] = await qb.getManyAndCount();
      return { data, total };
    }

    const whereCondition: Record<string, unknown> = turfId ? { turfId } : {};
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
  async findOne(
    id: string,
    options?: { includeHidden?: boolean },
  ): Promise<Camera> {
    const includeHidden = options?.includeHidden ?? false;

    const resolveVisible = async (
      camera: Camera | null,
    ): Promise<Camera | null> => {
      if (!camera) return null;
      if (includeHidden) return camera;

      if (camera.hidden_from_app) return null;

      if (camera.turfId) {
        const turf =
          camera.turf ??
          (await this.cameraRepository.manager.findOne(TurfEntity, {
            where: { id: camera.turfId },
          }));
        if (turf?.hidden_from_app) {
          return null;
        }
      }

      return camera;
    };

    const camera = await this.cameraRepository.findOne({
      where: { id },
      relations: ['turf'],
    });
    const visibleCamera = await resolveVisible(camera);
    if (visibleCamera) {
      return visibleCamera;
    }

    const legacyResolvedId = resolveLegacyQrCameraId(id);
    if (legacyResolvedId) {
      const legacyCamera = await this.cameraRepository.findOne({
        where: { id: legacyResolvedId },
        relations: ['turf'],
      });
      const visibleLegacy = await resolveVisible(legacyCamera);
      if (visibleLegacy) {
        return visibleLegacy;
      }
    }

    throw new NotFoundException(`Camera with ID ${id} not found`);
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
