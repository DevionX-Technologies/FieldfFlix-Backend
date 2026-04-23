import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  Repository,
  SelectQueryBuilder,
  UpdateResult,
} from 'typeorm';
import {
  CreateTurfAmenitiesDto,
  CreateTurfDto,
  DeletingTurfImageDto,
  GetTurfsQueryDto,
  InsertsTurfImageDto,
  UpdateTurfDto,
} from './dto/turfs.dto';
import { TurfEntity } from './entities/turfs.entity';
import { TurfAmenitiesEntity } from './entities/turf-amenities.entity';
import { FileServiceService } from 'src/file-service/file-service.service';
import { TurfImageEntity } from './entities/turf-images.entity';
import {
  IPaginationOptions,
  paginate,
  Pagination,
} from 'tekvo-nest-typeorm-paginate';

@Injectable()
export class TurfsService {
  private readonly logger = new Logger(TurfsService.name);
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TurfEntity)
    private readonly turfRepository: Repository<TurfEntity>,
    private readonly fileService: FileServiceService,
  ) {}

  async createNewTurf(
    insertTurfInPayload: CreateTurfDto,
  ): Promise<{ message: string; status: number; data: TurfEntity }> {
    this.logger.log('Starting turf insertion process');
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { latitude, longitude, amenities, ...insertTurf } =
        insertTurfInPayload;

      this.logger.log(
        `Inserting turf with coordinates: lat ${latitude}, long ${longitude}`,
      );
      const geo_locations = {
        type: 'Point',
        coordinates: [longitude, latitude],
      };
      // Create and save turf entity in a single operation
      const insertTurfInDb = await queryRunner.manager.save(TurfEntity, {
        ...insertTurf,
        geo_location: geo_locations,
      });

      // Only process amenities if they exist
      if (amenities && Object.keys(amenities).length) {
        this.logger.log(`Adding amenities for turf ID: ${insertTurfInDb.id}`);
        await queryRunner.manager.save(TurfAmenitiesEntity, {
          turf_id: insertTurfInDb.id,
          ...amenities,
          amenities_details: amenities.amenities_details,
        });
      }

      await queryRunner.commitTransaction();
      this.logger.log(
        `Turf insertion completed successfully with ID: ${insertTurfInDb.id}`,
      );

      return {
        message: 'Turf inserted successfully',
        status: HttpStatus.CREATED,
        data: insertTurfInDb,
      };
    } catch (error) {
      this.logger.error(`Error inserting turf: ${error.message}`, error.stack);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async removeTurfById(
    turfId: string,
  ): Promise<{ message: string; status: number }> {
    this.logger.log(`Starting deletion process for turf ID: ${turfId}`);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const findTurf = await queryRunner.manager.findOne(TurfEntity, {
        where: { id: turfId },
      });

      if (!findTurf) {
        this.logger.warn(`Turf not found with ID: ${turfId}`);
        throw new Error('Turf not found');
      }

      const findTurfAllImages = await queryRunner.manager.find(
        TurfImageEntity,
        {
          where: { turf_id: turfId },
        },
      );

      findTurfAllImages.forEach((image) => {
        this.fileService.deleteFileFormS3(image.bucket_name, image.image_url);
      });

      this.logger.log(`Deleting turf and its amenities for ID: ${turfId}`);
      await Promise.all([
        queryRunner.manager.delete(TurfEntity, { id: turfId }),
        queryRunner.manager.delete(TurfAmenitiesEntity, {
          turf_id: turfId,
        }),
        queryRunner.manager.delete(TurfImageEntity, {
          turf_id: turfId,
        }),
      ]);

      await queryRunner.commitTransaction();

      this.logger.log(`Turf deletion completed successfully for ID: ${turfId}`);

      return {
        message: 'Turf deleted successfully',
        status: HttpStatus.NO_CONTENT,
      };
    } catch (error) {
      this.logger.error(`Error deleting turf: ${error.message}`, error.stack);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async modifyTurfById(
    turfId: string,
    updateTurfInPayload: UpdateTurfDto,
  ): Promise<{ message: string; status: number; data: UpdateResult }> {
    this.logger.log(`Starting update process for turf ID: ${turfId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const findTurf = await queryRunner.manager.findOne(TurfEntity, {
        where: { id: turfId },
      });

      if (!findTurf) {
        this.logger.error(`Turf not found with ID: ${turfId}`);
        throw new BadRequestException('Turf not found');
      }

      const { latitude, longitude, ...updateTurf } = updateTurfInPayload;
      this.logger.log(`Updating turf with ID: ${turfId}`);
      let geo_locations;

      if (latitude && longitude) {
        geo_locations = {
          type: 'Point',
          coordinates: [longitude, latitude],
        };
      }

      this.logger.log(updateTurf);

      const updatedTurfDetails = await queryRunner.manager.update(
        TurfEntity,
        { id: turfId },
        {
          ...updateTurf,
          geo_location: geo_locations,
        },
      );

      await queryRunner.commitTransaction();

      return {
        message: 'Turf updated successfully',
        status: HttpStatus.OK,
        data: updatedTurfDetails,
      };
    } catch (error) {
      this.logger.error(`Error updating turf: ${error.message}`, error.stack);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async modifyTurfAmenitiesById(
    turfId: string,
    id: string,
    updateTurfAmenitiesInPayload: CreateTurfAmenitiesDto,
  ): Promise<{ message: string; status: number; data: UpdateResult }> {
    this.logger.log(
      `Starting update process for turf amenities for turf ID: ${turfId}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const findTurf = await queryRunner.manager.findOne(TurfAmenitiesEntity, {
        where: { id, turf_id: turfId },
      });

      if (!findTurf) {
        this.logger.error(
          `Turf amenities not found with ID: ${id} for turf ID: ${turfId}`,
        );
        throw new NotFoundException(
          `Turf amenities not found with ID: ${id} for turf ID: ${turfId}`,
        );
      }
      this.logger.log(`Updating turf amenities for turf ID: ${turfId}`);

      const updatedTurfAmenitiesDetails = await queryRunner.manager.update(
        TurfAmenitiesEntity,
        { id, turf_id: turfId },
        {
          ...updateTurfAmenitiesInPayload,
        },
      );

      await queryRunner.commitTransaction();

      return {
        message: 'Turf amenities updated successfully',
        status: HttpStatus.OK,
        data: updatedTurfAmenitiesDetails,
      };
    } catch (error) {
      this.logger.error(
        `Error updating turf amenities: ${error.message}`,
        error.stack,
      );
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getTurfsBaseOnQuery(
    query: GetTurfsQueryDto,
  ): Promise<Pagination<TurfEntity> | []> {
    const options: IPaginationOptions = {
      page: query.page || 1,
      limit: query.limit || 10,
    };

    const queryBuilder = this.turfRepository
      .createQueryBuilder('turf')
      .leftJoinAndSelect('turf.amenities', 'amenities')
      .leftJoinAndSelect('turf.turfImages', 'turfImages');

    await this.applyFilters(queryBuilder, query);

    const items = await paginate<TurfEntity>(queryBuilder, options);

    return items?.items ? items : [];
  }

  private async applyFilters(
    queryBuilder: SelectQueryBuilder<TurfEntity>,
    query: GetTurfsQueryDto,
  ): Promise<void> {
    this.applyBasicFilters(queryBuilder, query);
    this.applyLocationFilters(queryBuilder, query);
    this.applyPricingFilters(queryBuilder, query);
    this.applyGeoFilters(queryBuilder, query);

    queryBuilder.andWhere('turf.is_active = :is_active', { is_active: true });
  }

  private applyBasicFilters(
    queryBuilder: SelectQueryBuilder<TurfEntity>,
    query: GetTurfsQueryDto,
  ): void {
    const { name, surface_type, sports_supported, max_capacity } = query;

    if (name) {
      queryBuilder.andWhere('turf.name ILIKE :name', { name: `%${name}%` });
    }

    if (surface_type) {
      queryBuilder.andWhere(
        'turf.surface_type && ARRAY[:...surface_type]::"ESurfaceType"[]',
        {
          surface_type: Array.isArray(surface_type)
            ? surface_type
            : [surface_type],
        },
      );
    }

    if (sports_supported) {
      queryBuilder.andWhere(
        'turf.sports_supported && ARRAY[:...sports_supported]::"ESportsSupported"[]',
        {
          sports_supported: Array.isArray(sports_supported)
            ? sports_supported
            : [sports_supported],
        },
      );
    }

    if (max_capacity) {
      queryBuilder.andWhere('turf.max_capacity >= :max_capacity', {
        max_capacity,
      });
    }
  }

  private applyLocationFilters(
    queryBuilder: SelectQueryBuilder<TurfEntity>,
    query: GetTurfsQueryDto,
  ): void {
    const { city, state, country, postal_code, location } = query;

    if (city) {
      queryBuilder.andWhere('turf.city ILIKE :city', { city: `%${city}%` });
    }

    if (state) {
      queryBuilder.andWhere('turf.state ILIKE :state', { state: `%${state}%` });
    }

    if (country) {
      queryBuilder.andWhere('turf.country ILIKE :country', {
        country: `%${country}%`,
      });
    }

    if (postal_code) {
      queryBuilder.andWhere('turf.postal_code = :postal_code', { postal_code });
    }

    if (location) {
      queryBuilder.andWhere('turf.location ILIKE :location', {
        location: `%${location}%`,
      });
    }
  }

  private applyPricingFilters(
    queryBuilder: SelectQueryBuilder<TurfEntity>,
    query: GetTurfsQueryDto,
  ): void {
    const { hourly_rate_min, hourly_rate_max } = query;

    if (hourly_rate_min) {
      queryBuilder.andWhere('turf.hourly_rate >= :hourly_rate_min', {
        hourly_rate_min,
      });
    }

    if (hourly_rate_max) {
      queryBuilder.andWhere('turf.hourly_rate <= :hourly_rate_max', {
        hourly_rate_max,
      });
    }
  }

  private applyGeoFilters(
    queryBuilder: SelectQueryBuilder<TurfEntity>,
    query: GetTurfsQueryDto,
  ): void {
    const { latitude, longitude, radius } = query;

    if (latitude && longitude && radius) {
      queryBuilder.andWhere(
        `ST_DWithin(turf.geo_location, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326), :radius)`,
        { latitude, longitude, radius: radius * 1000 },
      );
    }
  }

  async removeTurfImages(
    deletingTurfImage: DeletingTurfImageDto[],
  ): Promise<{ message: string; status: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const image of deletingTurfImage) {
        const { turf_id, turf_image_id } = image;
        const findTurf = await queryRunner.manager.findOne(TurfImageEntity, {
          where: { id: turf_image_id, turf_id: turf_id },
        });

        if (!findTurf) {
          this.logger.error(
            `Turf image not found with ID: ${turf_image_id} for turf ID: ${turf_id}`,
          );
          throw new NotFoundException(
            `Turf image not found with ID: ${turf_image_id} for turf ID: ${turf_id}`,
          );
        }
        Promise.all([
          await this.fileService.deleteFileFormS3(
            findTurf.bucket_name,
            findTurf.image_url,
          ),
          queryRunner.manager.delete(TurfAmenitiesEntity, {
            id: turf_image_id,
            turf_id: turf_id,
          }),
        ]);
      }

      await queryRunner.commitTransaction();
      return {
        message: 'Turf image deleted successfully',
        status: HttpStatus.NO_CONTENT,
      };
    } catch (error) {
      this.logger.error(
        `Error deleting turf image: ${error.message}`,
        error.stack,
      );
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  async insertsTurfImagesInDb(
    insertsDocumentPayload: InsertsTurfImageDto,
  ): Promise<{ message: string; status: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Use Promise.all to handle multiple inserts concurrently
      await Promise.all(
        insertsDocumentPayload.uploadFileDetailsInsertsInDb.map(
          async (item) => {
            const fileSizeBigInt = item.file_size
              ? BigInt(item.file_size)
              : null;
            // Create document entity object directly
            const documentEntity = queryRunner.manager.create(TurfImageEntity, {
              turf_id: insertsDocumentPayload.turf_id,
              bucket_name: item.bucket_name,
              file_name: item.file_name,
              content_type: item.content_type,
              file_size: fileSizeBigInt,
              image_url: item.image_url,
              is_turf_profile: item.is_turf_profile,
            });

            // Insert the document entity into the database
            await queryRunner.manager.save(documentEntity);
          },
        ),
      );

      await queryRunner.commitTransaction();
      return {
        message: 'Document details inserted successfully',
        status: HttpStatus.CREATED,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to insert document details:', error);
      throw new Error(`Failed to insert document details: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  async retrieveTurfById(turfId: string): Promise<TurfEntity> {
    const turf = await this.turfRepository.findOne({
      where: { id: turfId },
      relations: ['turfImages', 'amenities'],
    });

    if (!turf) {
      this.logger.error(`Turf not found with ID: ${turfId}`);
      return null;
    }

    if (turf.turfImages && turf.turfImages.length > 0) {
      for (const image of turf.turfImages) {
        image.image_url = await this.fileService.getSignedUrlFromS3(
          image.image_url,
          image.bucket_name,
        );
      }
    }
    return turf;
  }
}
