import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, QueryRunner, Repository } from 'typeorm';
import { StartRecordingDto } from '../dto/start-recording.dto';
import {
  FindAndClaimRecordingDto,
  FindRecordingsDto,
} from '../dto/find-claim-recording.dto';
import { RaspberryPiApiService } from '../../raspberry-pi/raspberry-pi-api.service';
import { Camera } from '../../camera/camera.entity';
import { FileServiceService } from 'src/file-service/file-service.service';
import { ESortOrder } from 'src/media-upload/enum/media-upload.enum';
import { QueryUserMediaDto } from 'src/media-upload/dto/media-upload.dto';
import { v4 as uuidv4 } from 'uuid';
import { CreateSharedRecordingDto } from '../dto/create-shared-recording.dto';
import { SharedRecording } from '../entities/shared-recording.entity';
import { User } from '../../user/entities/user.entity';
import { MuxService } from 'src/mux/mux.service';
import { FireBaseNotificationService } from 'src/common/service/fire-base.service';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { MessageStatus, NotificationType } from 'src/constant/enum';
import { Recording } from '../entities/recording.entity';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { RecordingHighlights } from '../entities/recording-highlights.entity';
import {
  PaymentStatus,
  PaymentEntity,
} from 'src/payment/entities/payment.entity';
import { deriveFlickSportFromTurf } from 'src/common/turf-flick-sport.util';
import {
  calculatePaymentAmountFromDuration,
  formatDurationToHHMMSS,
} from 'src/utils/utils';
import {
  HIGHLIGHT_STATUS,
  HOURLY_RATE,
  MUX_API_BASE_URL,
} from 'src/constant/constant';
import axios from 'axios';
import {
  muxIsStaticRenditionAlreadyDefinedResponse,
  muxStaticRenditionFileRows,
  muxStaticRenditionsBucketStatus,
} from 'src/utils/mux-static-renditions';
import { SharedRecordingResponseDto } from '../dto/shared-recording-response.dto';
import { RecordingHighlightEngagementService } from './recording-highlight-engagement.service';
import { PaymentRestrictionService } from 'src/payment/payment-restriction.service';

/**
 * Service for managing recordings.
 */
@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);
  /** `recordings.startTime/endTime` are stored as IST wall-clock in `timestamp without time zone`. */
  private static readonly IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  /**
   * Normalize a DB timestamp-without-timezone value that represents IST wall-clock
   * into a stable UTC `Date`, independent of server timezone.
   */
  private normalizeIstTimestamp(
    value: Date | string | null | undefined,
  ): Date | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const wallClockAsUtc = Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    );
    return new Date(wallClockAsUtc - RecordingService.IST_OFFSET_MS);
  }
  private readonly lambdaClient: LambdaClient;

  /** If `in_progress` is older than this, it is treated as abandoned (app crash / no stop) and cleared. */
  private static readonly STALE_IN_PROGRESS_MS = 2 * 60 * 60 * 1000; // 2 hours

  /**
   * @param recordingRepository The repository for the Recording entity.
   * @param sharedRecordingRepository The repository for the SharedRecording entity.
   * @param userRepository The repository for the User entity.
   * @param cameraRepository The repository for the Camera entity.
   * @param raspberryPiApiService Service for interacting with the Raspberry Pi API.
   * @param muxService Service for interacting with the Mux API.
   * @param fileServiceService Service for interacting with file storage (S3).
   * @param configService Service for accessing configuration values.
   */
  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepository: Repository<Recording>,
    @InjectRepository(Camera) // Inject Camera repository to check camera existence
    private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(RecordingHighlights)
    private readonly recordingHighlightsRepository: Repository<RecordingHighlights>,
    private readonly raspberryPiApiService: RaspberryPiApiService,
    private readonly fileServiceService: FileServiceService,
    @InjectRepository(Recording)
    private readonly recordingRepositoryForMedia: Repository<Recording>,
    @InjectRepository(SharedRecording)
    private readonly sharedRecordingRepository: Repository<SharedRecording>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly muxService: MuxService,
    private readonly fireBaseNotificationService: FireBaseNotificationService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly recordingHighlightEngagementService: RecordingHighlightEngagementService,
    private readonly paymentRestrictionService: PaymentRestrictionService,
  ) {
    // Match S3 client: use explicit keys when present (local/.env), else default chain (IAM role).
    const region = process.env.AWS_REGION || 'ap-south-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;
    this.lambdaClient = new LambdaClient({
      region,
      ...(accessKeyId &&
        secretAccessKey && {
          credentials: {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          },
        }),
    });
  }

  /**
   * Helper to send push notifications and store in DB for all user devices.
   * @param user User entity with user_devices_token relation
   * @param title Notification title
   * @param body Notification body
   * @param notification_type Type of notification (e.g., RECORDING_START)
   * @param dbData Data to store in DB (array/object)
   * @param clickAction Optional click_action for push notification
   * @param manager Optional transaction manager (for transactional save)
   */
  private async sendAndStoreNotificationForUserDevices({
    user,
    title,
    body,
    notification_type,
    dbData,
    clickAction,
    queryRunner,
  }: {
    user: User;
    title: string;
    body: string;
    notification_type: string;
    dbData: any;
    clickAction?: string;
    queryRunner?: QueryRunner;
  }) {
    for (const deviceTokenObj of user.user_devices_token) {
      const token = deviceTokenObj.devices_id;
      // Send push notification
      await this.fireBaseNotificationService.sendNotification(
        {
          notification: { title, body },
          token,
          data: { click_action: clickAction || '' },
        },
        user.id,
      );
    }

    const notificationPayload = {
      user_id: user.id,
      title,
      body,
      data: dbData,
      message_status: MessageStatus.UNREAD,
      notification_type,
      is_soft_delete: false,
    };

    await queryRunner.manager.save(NotificationEntity, notificationPayload);
  }

  private isInProgressRecordingStale(rec: Recording): boolean {
    if (!rec?.startTime) return true;
    const start = new Date(rec.startTime).getTime();
    if (Number.isNaN(start)) return true;
    return Date.now() - start > RecordingService.STALE_IN_PROGRESS_MS;
  }

  /**
   * Marks a stuck `in_progress` row as ended so a new session can start.
   * Best-effort stop on the Raspberry Pi (do not block start on failure).
   */
  private async abandonOrphanInProgressRecording(
    rec: Recording,
  ): Promise<void> {
    this.logger.warn(
      `Clearing stale in_progress recording ${rec.id} for camera ${rec.cameraId} (started ${rec.startTime})`,
    );
    rec.status = 'interrupted';
    rec.endTime = new Date();
    await this.recordingRepository.save(rec);

    const baseUrl = rec.camera?.raspberryPiBaseUrl;
    const piId = rec.raspberryPiRecordingId;
    if (baseUrl && piId) {
      this.raspberryPiApiService
        .stopRecording(baseUrl, piId)
        .catch((e: Error) =>
          this.logger.warn(
            `Best-effort Pi stop for abandoned recording ${rec.id}: ${e?.message}`,
          ),
        );
    }
  }

  /**
   * Starts a new recording for a user and camera.
   * Checks if a recording is already in progress for the camera.
   * Calls the Raspberry Pi API to initiate recording with exponential backoff retry logic.
   * Stores the recording details in the database.
   *
   * @param startRecordingDto The DTO containing recording details.
   * @returns The created Recording entity.
   * @throws ConflictException if a recording is already in progress for the camera.
   * @throws NotFoundException if the camera does not exist.
   * @throws InternalServerErrorException if starting the recording on Raspberry Pi fails after multiple retries.
   */
  async startRecording(
    startRecordingDto: StartRecordingDto,
  ): Promise<Recording> {
    const { userId, cameraId, metadata, turfId } = startRecordingDto;

    // 1. Check if the camera exists
    const camera = await this.cameraRepository.findOne({
      where: { id: cameraId },
    });

    if (!camera) {
      throw new NotFoundException(`Camera with ID ${cameraId} not found.`);
    }

    // 2. Check if a recording is already in progress for this camera
    const existingRecording = await this.recordingRepository.findOne({
      where: { cameraId, status: 'in_progress' },
      relations: ['camera'],
    });

    if (existingRecording) {
      if (this.isInProgressRecordingStale(existingRecording)) {
        await this.abandonOrphanInProgressRecording(existingRecording);
      } else {
        throw new ConflictException({
          message: `Recording is already in progress for camera with ID ${cameraId}.`,
          existingRecordingId: existingRecording.id,
          cameraId,
        });
      }
    }

    // 3. Call Raspberry Pi API to start recording with exponential backoff retry logic
    let raspberryPiRecordingId: string | null = null;
    const maxRetries = 3;
    const baseDelayMs = 1000; // 1 second base delay
    const multiplier = 2; // Multiplier for exponential backoff

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await this.raspberryPiApiService.startRecording(
          camera.raspberryPiBaseUrl,
        );
        raspberryPiRecordingId = response.recordingId;
        this.logger.log(
          `Recording started on Raspberry Pi with ID: ${raspberryPiRecordingId}`,
        );
        break;
      } catch (error) {
        const delayMs = baseDelayMs * Math.pow(multiplier, i);
        this.logger.error(
          `Attempt ${i + 1} to start recording on Raspberry Pi failed. Retrying in ${delayMs}ms: ${error.message}`,
        );
        if (i === maxRetries - 1) {
          throw new InternalServerErrorException(
            `Failed to start recording after ${maxRetries} retries.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (!raspberryPiRecordingId) {
      // This case should ideally not be reached if the last retry throws an exception, but as a safeguard
      // This could happen if the last retry didn't throw but also didn't set raspberryPiRecordingId
      throw new InternalServerErrorException(
        'Failed to obtain Raspberry Pi recording ID after retries.',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 4. Create and save the recording entity in the database
      const newRecording = queryRunner.manager.create(Recording, {
        userId,
        cameraId,
        startTime: new Date(),
        turfId,
        status: 'in_progress',
        raspberryPiRecordingId: raspberryPiRecordingId, // Store RPi's recording ID
        metadata: metadata, // Store optional metadata
      });

      const savedRecording = await queryRunner.manager.save(
        Recording,
        newRecording,
      );

      this.logger.log(`Recording entity saved with ID: ${savedRecording.id}`);

      const findAllDeviceTokeToSendNotification =
        await queryRunner.manager.findOne(User, {
          where: { id: userId },
          relations: ['user_devices_token'],
        });

      if (findAllDeviceTokeToSendNotification.user_devices_token.length === 0) {
        await queryRunner.commitTransaction();
        return savedRecording;
      } else {
        const title = 'Lights, camera, action 🎬';
        const body = 'Your game is now live - make every move count!';
        const notification_type = NotificationType.RECORDING_START;
        const dbData = [
          {
            recordingId: savedRecording.id,
            cameraId: savedRecording.cameraId,
            userId: savedRecording.userId,
            startTime: savedRecording.startTime,
            turfId: savedRecording.turfId,
            status: savedRecording.status,
            raspberryPiRecordingId: savedRecording.raspberryPiRecordingId,
            metadata: savedRecording.metadata,
          },
        ];
        await this.sendAndStoreNotificationForUserDevices({
          user: findAllDeviceTokeToSendNotification,
          title,
          body,
          notification_type,
          dbData,
          clickAction: 'RECORDING_START',
          queryRunner,
        });
      }

      await queryRunner.commitTransaction();
      return savedRecording;
    } catch (error) {
      this.logger.error('Error in start recording:', error);
      await queryRunner.rollbackTransaction();
      if (error instanceof HttpException) {
        throw new HttpException(error.getResponse(), error.getStatus());
      }
      throw new InternalServerErrorException(error.message);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Stops an ongoing recording.
   * Returns immediately with "processing" status.
   * The actual processing happens in background.
   *
   * @param recordingId The ID of the recording to stop.
   * @returns The updated Recording entity with "processing" status.
   * @throws NotFoundException if the recording is not found or not in progress.
   * @throws InternalServerErrorException if the Raspberry Pi recording ID is missing on the recording entity.
   */
  async stopRecording(recordingId: string): Promise<Recording> {
    // 1. Find the recording and ensure it is in progress
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId, status: 'in_progress' },
      relations: ['camera'],
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found or not in progress.`,
      );
    }

    // Use the raspberryPiRecordingId stored during start
    const raspberryPiRecordingId = recording.raspberryPiRecordingId;

    if (!raspberryPiRecordingId) {
      throw new InternalServerErrorException(
        'Raspberry Pi recording ID not found for recording.',
      );
    }

    // 2. Update status to 'processing' and return immediately
    recording.status = 'processing';
    recording.endTime = new Date();
    const updatedRecording = await this.recordingRepository.save(recording);

    this.logger.log(
      `Recording ${recordingId} marked as processing. Starting background processing...`,
    );

    // 3. Process in background (fire and forget)
    this.processStopRecordingInBackground(
      recordingId,
      recording.camera.raspberryPiBaseUrl,
      raspberryPiRecordingId,
      recording.userId,
    ).catch((error) => {
      this.logger.error(
        `Background processing failed for recording ${recordingId}:`,
        error,
      );
    });

    return updatedRecording;
  }

  /**
   * Background process to handle Raspberry Pi stop recording.
   * This runs asynchronously without blocking the API response.
   *
   * @param recordingId The ID of the recording.
   * @param raspberryPiBaseUrl The base URL of the Raspberry Pi.
   * @param raspberryPiRecordingId The Raspberry Pi's recording ID.
   * @param userId The user ID for notifications.
   */
  private async processStopRecordingInBackground(
    recordingId: string,
    raspberryPiBaseUrl: string,
    raspberryPiRecordingId: string,
    userId: string,
  ): Promise<void> {
    let s3Path: string | null = null;
    const maxRetries = 3;
    const baseDelayMs = 1000;
    const multiplier = 2;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Call Raspberry Pi API to stop recording with retry logic
      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await this.raspberryPiApiService.stopRecording(
            raspberryPiBaseUrl,
            raspberryPiRecordingId,
          );
          console.log('response from raspberryPi API service', response);
          s3Path = response.s3Path;
          this.logger.log(
            `Recording stopped on Raspberry Pi. S3 Path: ${s3Path}`,
          );
          break; // Exit loop on success
        } catch (error) {
          const delayMs = baseDelayMs * Math.pow(multiplier, i);
          this.logger.error(
            `Attempt ${i + 1} to stop recording on Raspberry Pi failed. Retrying in ${delayMs}ms: ${error.message}`,
          );
          if (i === maxRetries - 1) {
            // Final retry failed - mark as failed
            await queryRunner.manager.update(Recording, recordingId, {
              status: 'failed',
            });
            throw new InternalServerErrorException(
              `Failed to stop recording on Raspberry Pi after ${maxRetries} retries.`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      if (!s3Path) {
        await queryRunner.manager.update(Recording, recordingId, {
          status: 'failed',
        });
        throw new InternalServerErrorException(
          'Failed to obtain S3 path from Raspberry Pi after retries.',
        );
      }

      const s3UrlParts = s3Path.replace('s3://', '').split('/');
      // const bucketNameFromPath = s3UrlParts[0];
      let s3Key = s3UrlParts.slice(1).join('/');

      s3Key = s3Key.replace(/^video\//, '');
      if (!s3Key.startsWith('recordings/')) {
        s3Key = `recordings/${s3Key}`;
      }

      this.logger.log(
        `Preparing Mux upload for recordingId: ${recordingId}, S3 key: ${s3Key}`,
      );

      // Update the recording entity with success status
      await queryRunner.manager.update(Recording, recordingId, {
        status: 'completed',
        s3Path: s3Key,
      });

      this.logger.log(
        `Recording ${recordingId} completed with S3 path: ${s3Key}`,
      );

      // Trigger Mux upload
      // try {
      //   setTimeout(() => {
      //     console.log('Triggering Mux upload...', s3Key);
      //     this.triggerMuxUpload(recordingId, s3Key, bucketNameFromPath);
      //   }, 5000);
      // } catch (error) {
      //   this.logger.error(
      //     `Failed to trigger Mux upload for recordingId: ${recordingId}`,
      //     error.stack,
      //   );
      //   await queryRunner.manager.update(Recording, recordingId, {
      //     status: 'failed',
      //   });
      // }

      // Send notification to all user devices and store in DB
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
        relations: ['user_devices_token'],
      });

      if (user && user.user_devices_token.length > 0) {
        const title = "And that's a wrap!";
        const body =
          "Hope you left it all on the field. Now, let's see what the replay says!";
        const dbData = [
          {
            recordingId: recordingId,
            cameraId: (
              await queryRunner.manager.findOne(Recording, {
                where: { id: recordingId },
              })
            )?.cameraId,
            userId: userId,
            stopTime: new Date(),
            s3Path: s3Key,
            status: 'completed',
          },
        ];
        const notification_type = NotificationType.RECORDING_STOP;
        await this.sendAndStoreNotificationForUserDevices({
          user,
          title,
          body,
          notification_type,
          dbData,
          clickAction: 'RECORDING_STOP',
          queryRunner,
        });
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      this.logger.error(
        `Error in background stop recording processing for ${recordingId}:`,
        error,
      );
      await queryRunner.rollbackTransaction();

      // Try to update status to failed (outside transaction)
      try {
        await this.recordingRepository.update(recordingId, {
          status: 'failed',
        });
      } catch (updateError) {
        this.logger.error(
          `Failed to update recording status to failed: ${updateError.message}`,
        );
      }
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get the current status of a recording.
   * Useful for clients to poll after calling stop recording.
   *
   * @param recordingId The ID of the recording.
   * @returns Object with recording status and details.
   * @throws NotFoundException if the recording is not found.
   */
  async getRecordingStatus(recordingId: string): Promise<{
    id: string;
    status: string;
    s3Path?: string;
    mux_playback_id?: string;
    startTime: Date;
    endTime?: Date;
  }> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      select: [
        'id',
        'status',
        's3Path',
        'mux_playback_id',
        'startTime',
        'endTime',
      ],
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }

    return {
      id: recording.id,
      status: recording.status,
      s3Path: recording.s3Path,
      mux_playback_id: recording.mux_playback_id,
      startTime: recording.startTime,
      endTime: recording.endTime,
    };
  }

  /**
   * Helper method to find an active recording for a camera.
   *
   * @param cameraId The ID of the camera.
   * @returns The active Recording entity if found, otherwise null.
   */
  async findActiveRecordingByCamera(
    cameraId: string,
  ): Promise<Recording | null> {
    return this.recordingRepository.findOne({
      where: { cameraId, status: 'in_progress' },
    });
  }

  /**
   * Retrieves a recording by its ID, including related user and camera information.
   *
   * @param recordingId The ID of the recording to retrieve.
   * @returns The Recording entity with user and camera relations, or null if not found.
   */
  async getRecordingById(recordingId: string): Promise<Recording | null> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      relations: ['user', 'turf', 'camera'],
    });
    if (!recording) return null;

    // If the asset is already published on Mux but the DB still says "processing"
    // (because a webhook didn't land), trust Mux and patch the row + response.
    if (
      recording.mux_asset_id &&
      (recording.status !== 'ready' || !recording.mux_playback_id)
    ) {
      try {
        const asset = await this.muxService.getAssetDetails(
          recording.mux_asset_id,
        );
        if (asset?.status === 'ready') {
          const livePlaybackId = Array.isArray(asset.playback_ids)
            ? (asset.playback_ids.find((p: any) => p?.policy === 'public')
                ?.id ??
              asset.playback_ids[0]?.id ??
              null)
            : null;

          const patch: Partial<Recording> = {};
          if (recording.status !== 'ready') patch.status = 'ready';
          if (livePlaybackId && !recording.mux_playback_id) {
            patch.mux_playback_id = livePlaybackId;
            patch.mux_media_url = `https://stream.mux.com/${livePlaybackId}.m3u8`;
          }
          if (Object.keys(patch).length > 0) {
            await this.recordingRepository.update(recording.id, patch);
            Object.assign(recording, patch);
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Mux self-heal in getRecordingById(${recordingId}) failed: ${err?.message ?? err}`,
        );
      }
    }

    const normalizedStart = this.normalizeIstTimestamp(recording.startTime);
    const normalizedEnd = this.normalizeIstTimestamp(recording.endTime);
    if (normalizedStart) (recording as any).startTime = normalizedStart;
    (recording as any).endTime = normalizedEnd;

    return recording;
  }

  /**
   * Updates the display name of a recording (owner only).
   *
   * @param recordingId The ID of the recording to update.
   * @param userId The ID of the user requesting the update (must own the recording).
   * @param recordingName The new display name.
   * @returns The updated Recording entity.
   * @throws NotFoundException if the recording is not found.
   * @throws ForbiddenException if the user does not own the recording.
   */
  async updateRecordingName(
    recordingId: string,
    userId: string,
    recordingName: string,
  ): Promise<Recording> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException(
        `User ${userId} does not own recording with ID ${recordingId}.`,
      );
    }

    await this.recordingRepository.update(recordingId, {
      recording_name: recordingName,
    });

    const updated = await this.recordingRepository.findOne({
      where: { id: recordingId },
    });
    return updated as Recording;
  }

  /**
   * Retrieves the S3 path for a recording by its ID.
   *
   * @param recordingId The ID of the recording.
   * @returns The S3 path of the recording.
   * @throws NotFoundException if the recording is not found.
   * @throws InternalServerErrorException if the recording is found but does not have an S3 path.
   */
  async getRecordingS3Path(recordingId: string): Promise<string> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      select: ['id', 's3Path'], // Select only necessary fields
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }

    if (!recording.s3Path) {
      // This might indicate an issue with the recording process completion
      throw new InternalServerErrorException(
        `S3 path not available for recording with ID ${recordingId}.`,
      );
    }

    return recording.s3Path;
  }

  /**
   * Generates or retrieves a share token for a media item (now recording).
   *
   * @param recordingId The ID of the recording.
   * @param userId The ID of the user requesting the share link.
   * @returns An object containing the share token.
   * @throws NotFoundException if the recording is not found.
   * @throws ForbiddenException if the user does not own the recording or it's not a video (although currently only videos are recordings).
   */
  async generateShareLink(
    recordingId: string,
    userId: string,
  ): Promise<{ share_token: string | null }> {
    const recording = await this.recordingRepositoryForMedia.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException(
        `User ${userId} does not own recording with ID ${recordingId}.`,
      );
    }

    if (recording.share_token !== null) {
      return { share_token: recording.share_token };
    }

    recording.share_token = uuidv4();
    await this.recordingRepositoryForMedia.save(recording);

    return { share_token: recording.share_token };
  }

  /**
   * Toggles the favorite status of a media item (now recording).
   *
   * @param recordingId The ID of the recording.
   * @param userId The ID of the user requesting to toggle the favorite status.
   * @returns The updated Recording entity.
   * @throws NotFoundException if the recording is not found.
   * @throws ForbiddenException if the user does not own the recording or it's not a video.
   */
  async toggleFavoriteStatus(
    recordingId: string,
    userId: string,
  ): Promise<Recording> {
    const recording = await this.recordingRepositoryForMedia.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException(
        `User ${userId} does not own recording with ID ${recordingId}.`,
      );
    }

    recording.is_favorite = !recording.is_favorite;
    const updatedRecording =
      await this.recordingRepositoryForMedia.save(recording);

    return updatedRecording;
  }

  /**
   * Retrieves a list of a user's favorite media items (now videos/recordings).
   *
   * @param userId The ID of the user.
   * @param query Query parameters for filtering and sorting.
   * @returns A list of favorite Recording entities.
   */
  async getFavoriteVideos(
    userId: string,
    query: QueryUserMediaDto,
  ): Promise<Recording[]> {
    const { sortOrder } = query; // turfId is not applicable to recordings

    const queryBuilder =
      this.recordingRepositoryForMedia.createQueryBuilder('recording');

    queryBuilder.where('recording.userId = :userId', { userId: userId });
    queryBuilder.andWhere('recording.is_favorite = :is_favorite', {
      is_favorite: true,
    });

    // Apply sorting
    if (sortOrder === ESortOrder.OLD_TO_NEW) {
      queryBuilder.orderBy('recording.startTime', 'ASC');
      queryBuilder.addOrderBy('recording.id', 'ASC'); // Secondary sort for consistent order
    } else {
      // Default to NEW_TO_OLD
      queryBuilder.orderBy('recording.startTime', 'DESC');
      queryBuilder.addOrderBy('recording.id', 'ASC'); // Secondary sort for consistent order
    }

    return queryBuilder.getMany();
  }

  /**
   * Retrieves a media item (now recording) by its share token.
   *
   * @param shareToken The share token.
   * @returns The S3 URL of the shared media ituem (recording), or null if not found or incomplete.
   */
  async getMediaByShareToken(
    shareToken: string,
    userId: string,
  ): Promise<string | null> {
    const recording = await this.recordingRepositoryForMedia.findOne({
      where: {
        share_token: shareToken,
      },
    });

    if (!recording) {
      return null;
    }

    if (userId) {
      const share = await this.sharedRecordingRepository.findOne({
        where: {
          recording_id: recording.id,
          shared_with_user_id: userId,
        },
      });

      if (!share) {
        await this.sharedRecordingRepository.save({
          recording_id: recording.id,
          shared_with_user_id: userId,
        });
      }
    }

    // Ensure essential fields are present
    if (!recording.mux_playback_id) {
      this.logger.error(
        `Shared recording record for token ${shareToken} is incomplete (missing mux_playback_id).`,
      );
      return null;
    }

    return recording.mux_media_url;

    // try {
    //   // Assuming s3Path is in the format 'bucket-name/key' or 's3://bucket-name/key'
    //   const s3UrlParts = recording.s3Path.replace('s3://', '').split('/');
    //   const bucketName = s3UrlParts[0];
    //   const s3Key = s3UrlParts.slice(1).join('/');

    //   if (!bucketName || !s3Key) {
    //     this.logger.error(
    //       `Failed to parse S3 path into bucket and key: ${recording.s3Path}`,
    //     );
    //     // Depending on desired behavior, could throw an error or return null
    //     throw new InternalServerErrorException(
    //       `Invalid S3 path format for recording with ID ${recording.id}.`,
    //     );
    //   }

    //   const presignedUrl = await this.fileServiceService.getSignedUrlFromS3(
    //     s3Key,
    //     bucketName,
    //   );

    //   return presignedUrl;
    // } catch (error: any) {
    //   this.logger.error(
    //     `Error generating presigned URL for shared recording token ${shareToken}: `,
    //     error,
    //   );

    //   // Wrap any errors in InternalServerErrorException for consistency
    //   throw new InternalServerErrorException(
    //     `Failed to get shared recording URL: ${error.message}`,
    //   );
    // }
  }

  /**
   * Creates a shared recording record between two users.
   *
   * @param createSharedRecordingDto The DTO containing recording and user IDs.
   * @param sharedByUserId The ID of the user sharing the recording.
   * @returns The created SharedRecording entity.
   * @throws NotFoundException if the recording or user is not found.
   * @throws ForbiddenException if the user is not authorized to share this recording.
   * @throws ConflictException if the recording is already shared with the user.
   * @throws BadRequestException if trying to share with self.
   */
  async createSharedRecording(
    createSharedRecordingDto: CreateSharedRecordingDto,
    sharedByUserId: string,
  ): Promise<SharedRecording> {
    const { recording_id, shared_with_user_id } = createSharedRecordingDto;

    // Check if trying to share with self
    if (sharedByUserId === shared_with_user_id) {
      throw new BadRequestException('Cannot share recording with yourself');
    }

    // Check if recording exists and belongs to the sharing user
    const recording = await this.recordingRepository.findOne({
      where: { id: recording_id, userId: sharedByUserId },
    });

    if (!recording) {
      throw new NotFoundException(
        'Recording not found or you do not have permission to share it',
      );
    }

    // Check if user to share with exists
    const sharedWithUser = await this.userRepository.findOne({
      where: { id: shared_with_user_id },
    });

    if (!sharedWithUser) {
      throw new NotFoundException('User to share with not found');
    }

    // Check if recording is already shared with this user
    const existingShare = await this.sharedRecordingRepository.findOne({
      where: {
        recording_id,
        shared_with_user_id,
      },
    });

    if (existingShare) {
      throw new ConflictException(
        'This recording is already shared with the specified user',
      );
    }

    // Create shared recording record
    const sharedRecording = this.sharedRecordingRepository.create({
      recording_id,
      shared_with_user_id,
    });

    return this.sharedRecordingRepository.save(sharedRecording);
  }

  /**
   * Retrieves all recordings owned by a specific user.
   *
   * @param userId The ID of the user whose recordings to retrieve.
   * @returns A Promise resolving to an array of Recording.
   */
  /**
   * Converts seconds to HH:MM:SS format
   */

  /**
   * Mux-ready recordings for admin FlickShort creation (picker + preview).
   * Returns a compact list; newest first.
   */
  async listMuxReadyRecordingsForAdmin(limit = 300): Promise<
    Array<{
      id: string;
      mux_playback_id: string;
      status: string;
      startTime: string;
      endTime: string | null;
      recording_name: string | null;
      turfName: string | null;
      flick_sport: 'pickleball' | 'padel' | 'cricket';
      turf_sports_supported: string[];
    }>
  > {
    const rows = await this.recordingRepository.find({
      where: {
        mux_playback_id: Not(IsNull()),
      },
      relations: ['turf'],
      order: { startTime: 'DESC', id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });

    return rows
      .filter(
        (r) => r.mux_playback_id && String(r.mux_playback_id).trim().length > 0,
      )
      .map((r) => ({
        id: r.id,
        mux_playback_id: r.mux_playback_id as string,
        status: r.status,
        startTime:
          r.startTime instanceof Date
            ? r.startTime.toISOString()
            : new Date(r.startTime as unknown as string).toISOString(),
        endTime: r.endTime
          ? r.endTime instanceof Date
            ? r.endTime.toISOString()
            : new Date(r.endTime as unknown as string).toISOString()
          : null,
        recording_name: r.recording_name ?? null,
        turfName: r.turf?.name ?? null,
        flick_sport: deriveFlickSportFromTurf(
          r.turf?.sports_supported,
          r.turf?.name,
        ),
        turf_sports_supported: (r.turf?.sports_supported ?? []).map((x) =>
          String(x),
        ),
      }));
  }

  async getMyRecordings(userId: string): Promise<Recording[]> {
    const recordings = await this.recordingRepository.find({
      where: {
        userId: userId,
        status: Not('failed'),
      },
      relations: [
        'camera',
        'sharedRecordings',
        'sharedRecordings.sharedWithUser',
        'recordingHighlights',
        'turf',
      ],
      order: {
        startTime: 'DESC',
        id: 'ASC',
      },
    });

    // Process each recording to add payment information using Promise.all
    const recordingsWithPayment = await Promise.all(
      recordings.map(async (recording) => {
        let gameDuration = formatDurationToHHMMSS(0);
        const paymentInfo: any = {
          status: PaymentStatus.PENDING,
          payment_amount: HOURLY_RATE,
          base_amount: HOURLY_RATE,
          game_duration: gameDuration,
        };

        // Create promises for parallel execution
        const promises: Promise<any>[] = [];

        // Get game duration from Mux asset
        if (recording.mux_asset_id) {
          promises.push(
            this.muxService
              .getAssetDetails(recording.mux_asset_id)
              .catch((error) => {
                this.logger.warn(
                  `Failed to get asset details for recording ${recording.id}:`,
                  error.message,
                );
                return null;
              }),
          );
        } else {
          promises.push(Promise.resolve(null));
        }

        // Check for existing payment with PENDING or COMPLETED status
        promises.push(
          this.recordingRepository.manager
            .createQueryBuilder(PaymentEntity, 'payment')
            .where('payment.recording_id = :recordingId', {
              recordingId: recording.id,
            })
            .andWhere('payment.user_id = :userId', { userId })
            .andWhere('payment.status IN (:...statuses)', {
              statuses: [PaymentStatus.PENDING, PaymentStatus.COMPLETED],
            })
            .getOne(),
        );

        // Wait for all promises to resolve
        const [assetDetails, existingPayment] = await Promise.all(promises);

        // Process asset details
        if (assetDetails && assetDetails.duration) {
          gameDuration = formatDurationToHHMMSS(assetDetails.duration);
          paymentInfo.game_duration = gameDuration;

          // Calculate payment amount based on duration
          paymentInfo.payment_amount = calculatePaymentAmountFromDuration(
            assetDetails.duration,
          );
        }

        // Treat Mux as the source of truth for "is the asset playable yet?"
        // The DB row can be left at `processing`/`completed` if the
        // `video.asset.ready` webhook never persisted (stale instance, missed
        // delivery, etc.). When Mux reports `ready` we patch the response (and
        // best-effort patch the DB) so the app stops showing "Processing".
        if (assetDetails && assetDetails.status === 'ready') {
          const livePlaybackId = Array.isArray(assetDetails.playback_ids)
            ? (assetDetails.playback_ids.find(
                (p: any) => p?.policy === 'public',
              )?.id ??
              assetDetails.playback_ids[0]?.id ??
              null)
            : null;

          if (recording.status !== 'ready') {
            (recording as any).status = 'ready';
          }
          if (livePlaybackId && !recording.mux_playback_id) {
            (recording as any).mux_playback_id = livePlaybackId;
            (recording as any).mux_media_url =
              `https://stream.mux.com/${livePlaybackId}.m3u8`;
          }

          // Self-heal the DB row in the background — never block the response.
          const needsDbPatch =
            recording.status !== 'ready' ||
            (livePlaybackId && !recording.mux_playback_id);
          if (needsDbPatch) {
            const patch: Partial<Recording> = { status: 'ready' };
            if (livePlaybackId && !recording.mux_playback_id) {
              patch.mux_playback_id = livePlaybackId;
              patch.mux_media_url = `https://stream.mux.com/${livePlaybackId}.m3u8`;
            }
            this.recordingRepository
              .update(recording.id, patch)
              .catch((err) =>
                this.logger.warn(
                  `Self-heal recording ${recording.id} failed: ${err?.message ?? err}`,
                ),
              );
          }
        }

        // Process existing payment
        if (existingPayment) {
          // Use existing payment data
          paymentInfo.status = existingPayment.status;
          paymentInfo.payment_amount = Number(existingPayment.amount);
          paymentInfo.base_amount =
            Number(existingPayment.base_amount) || HOURLY_RATE;
        }

        // Add payment info to recording
        (recording as any).payment = paymentInfo;

        const normalizedStart = this.normalizeIstTimestamp(recording.startTime);
        const normalizedEnd = this.normalizeIstTimestamp(recording.endTime);
        if (normalizedStart) (recording as any).startTime = normalizedStart;
        (recording as any).endTime = normalizedEnd;

        // Also, filter out failed highlights from recording.recordingHighlights if present
        if (Array.isArray((recording as any).recordingHighlights)) {
          (recording as any).recordingHighlights = (
            recording as any
          ).recordingHighlights.filter(
            (highlight: any) =>
              highlight.status !== 'failed' &&
              highlight.status !== 'PERMANENTLY_FAILED',
          );
        }

        return recording;
      }),
    );

    return recordingsWithPayment;
  }

  /**
   * Retrieves or creates a shared recording for the current user accessing a recording.
   * If the user already has access via a shared recording, returns it.
   * Otherwise, creates a new shared recording entry.
   *
   * @param recordingId The ID of the recording to access.
   * @param userId The ID of the user requesting access (from JWT token).
   * @returns The existing or newly created SharedRecording entity with relations.
   * @throws NotFoundException if the recording does not exist.
   */
  async getOrCreateSharedRecording(
    recordingId: string,
    userId: string,
  ): Promise<SharedRecording> {
    // Check if recording exists
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      relations: ['user'],
    });

    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    // Check if a shared recording already exists for this user
    let sharedRecording = await this.sharedRecordingRepository.findOne({
      where: {
        recording_id: recordingId,
        shared_with_user_id: userId,
      },
      relations: ['recording', 'sharedWithUser'],
    });

    // If shared recording exists, return it
    if (sharedRecording) {
      this.logger.log(
        `Found existing shared recording ${sharedRecording.id} for user ${userId}`,
      );
      return sharedRecording;
    }

    // Create new shared recording
    // The recording owner is set as the sharer
    sharedRecording = this.sharedRecordingRepository.create({
      recording_id: recordingId,
      shared_with_user_id: userId,
    });

    const savedSharedRecording =
      await this.sharedRecordingRepository.save(sharedRecording);

    // Fetch with relations for consistent response
    const result = await this.sharedRecordingRepository.findOne({
      where: { id: savedSharedRecording.id },
      relations: ['recording', 'sharedWithUser'],
    });

    this.logger.log(
      `Created new shared recording ${result.id} for user ${userId} on recording ${recordingId}`,
    );

    return result;
  }

  /**
   * Retrieves all recordings shared with a specific user.
   * Returns formatted response with recording details, turf information, and highlights.
   *
   * @param userId The ID of the user whose shared recordings to retrieve.
   * @returns A Promise resolving to an array of formatted SharedRecordingResponseDto.
   */
  async getSharedRecordings(
    userId: string,
  ): Promise<SharedRecordingResponseDto[]> {
    const sharedRecordings = await this.sharedRecordingRepository.find({
      where: {
        shared_with_user_id: userId,
      },
      relations: [
        'recording',
        'recording.recordingHighlights',
        'recording.turf',
        'recording.user',
        'sharedWithUser',
      ],
      order: {
        created_at: 'DESC',
      },
    });

    // Transform and format the response
    const formattedRecordings: SharedRecordingResponseDto[] = await Promise.all(
      sharedRecordings.map(async (sharedRecording) => {
        const recording = sharedRecording.recording;
        const owner = recording?.user;
        const turf = recording?.turf;
        const sharedWithUser = sharedRecording.sharedWithUser;

        // Generate presigned URL for S3 path
        let presignedS3Path: string | null = null;
        if (recording?.s3Path) {
          try {
            const s3UrlParts = recording.s3Path.replace('s3://', '').split('/');
            const bucketName = s3UrlParts[0];
            const s3Key = s3UrlParts.slice(1).join('/');

            if (bucketName && s3Key) {
              presignedS3Path =
                await this.fileServiceService.getSignedUrlFromS3(
                  s3Key,
                  bucketName,
                );
            }
          } catch (error) {
            this.logger.error(
              `Error generating presigned URL for recording ${recording.id}: ${error.message}`,
            );
          }
        }

        // Format turf detail
        const turfDetail = turf
          ? {
              id: turf.id,
              name: turf.name || '',
              geo_location: turf.geo_location || null,
              address_line: turf.address_line || null,
              city: turf.city || null,
              state: turf.state || null,
              postal_code: turf.postal_code || null,
              location: turf.location || null,
              country: turf.country || null,
            }
          : null;

        // Format recording highlights
        const recordingHighlights =
          recording?.recordingHighlights?.map((highlight) => ({
            id: highlight.id,
            button_click_timestamp: highlight.button_click_timestamp,
            relative_timestamp: highlight.relative_timestamp || null,
            asset_id: highlight.asset_id || null,
            status: highlight.status || null,
            playback_id: highlight.playback_id || null,
            mux_public_playback_url: highlight.mux_public_playback_url || null,
          })) || [];

        // Format the response
        return {
          id: sharedRecording.id,
          shared_with_user_id: sharedRecording.shared_with_user_id,
          shared_with_user_name: sharedWithUser?.name || '',
          recording: {
            id: recording.id,
            userId: recording.userId,
            owner_name: owner?.name || '',
            owner_phone: owner?.phone_number || '',
            turfId: recording.turfId || null,
            turf_detail: turfDetail,
            startTime: this.normalizeIstTimestamp(recording.startTime),
            endTime: this.normalizeIstTimestamp(recording.endTime),
            s3Path: presignedS3Path,
            status: recording.status,
            mux_asset_id: recording.mux_asset_id || null,
            mux_playback_id: recording.mux_playback_id || null,
            mux_media_url: recording.mux_media_url || null,
            recordingHighlights,
          },
        };
      }),
    );

    return formattedRecordings;
  }

  /**
   * Retrieves all recordings shared by a specific owner, including recipient details.
   */
  async getRecordingsSharedByMe(userId: string): Promise<
    Array<{
      id: string;
      shared_to_user_id: string;
      shared_to_user_name: string;
      shared_to_user_phone: string;
      recording: {
        id: string;
        userId: string;
        owner_name: string;
        turfId: string | null;
        turf_detail: {
          id: string;
          name: string;
          geo_location: any;
          address_line: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          location: string | null;
          country: string | null;
        } | null;
        startTime: Date | null;
        endTime: Date | null;
        s3Path: string | null;
        status: string;
        mux_asset_id: string | null;
        mux_playback_id: string | null;
        mux_media_url: string | null;
        recordingHighlights: Array<{
          id: string;
          button_click_timestamp: Date;
          relative_timestamp: string | null;
          asset_id: string | null;
          status: string | null;
          playback_id: string | null;
          mux_public_playback_url: string | null;
        }>;
      };
    }>
  > {
    const sharedRows = await this.sharedRecordingRepository.find({
      where: {
        recording: {
          userId,
        } as any,
      },
      relations: [
        'recording',
        'recording.recordingHighlights',
        'recording.turf',
        'recording.user',
        'sharedWithUser',
      ],
      order: {
        created_at: 'DESC',
      },
    });

    return Promise.all(
      sharedRows.map(async (sharedRecording) => {
        const recording = sharedRecording.recording;
        const owner = recording?.user;
        const turf = recording?.turf;
        const recipient = sharedRecording.sharedWithUser;

        let presignedS3Path: string | null = null;
        if (recording?.s3Path) {
          try {
            const s3UrlParts = recording.s3Path.replace('s3://', '').split('/');
            const bucketName = s3UrlParts[0];
            const s3Key = s3UrlParts.slice(1).join('/');

            if (bucketName && s3Key) {
              presignedS3Path =
                await this.fileServiceService.getSignedUrlFromS3(
                  s3Key,
                  bucketName,
                );
            }
          } catch (error) {
            this.logger.error(
              `Error generating presigned URL for recording ${recording.id}: ${error.message}`,
            );
          }
        }

        const turfDetail = turf
          ? {
              id: turf.id,
              name: turf.name || '',
              geo_location: turf.geo_location || null,
              address_line: turf.address_line || null,
              city: turf.city || null,
              state: turf.state || null,
              postal_code: turf.postal_code || null,
              location: turf.location || null,
              country: turf.country || null,
            }
          : null;

        const recordingHighlights =
          recording?.recordingHighlights?.map((highlight) => ({
            id: highlight.id,
            button_click_timestamp: highlight.button_click_timestamp,
            relative_timestamp: highlight.relative_timestamp || null,
            asset_id: highlight.asset_id || null,
            status: highlight.status || null,
            playback_id: highlight.playback_id || null,
            mux_public_playback_url: highlight.mux_public_playback_url || null,
          })) || [];

        return {
          id: sharedRecording.id,
          shared_to_user_id: sharedRecording.shared_with_user_id,
          shared_to_user_name: recipient?.name || '',
          shared_to_user_phone: recipient?.phone_number || '',
          recording: {
            id: recording.id,
            userId: recording.userId,
            owner_name: owner?.name || '',
            turfId: recording.turfId || null,
            turf_detail: turfDetail,
            startTime: this.normalizeIstTimestamp(recording.startTime),
            endTime: this.normalizeIstTimestamp(recording.endTime),
            s3Path: presignedS3Path,
            status: recording.status,
            mux_asset_id: recording.mux_asset_id || null,
            mux_playback_id: recording.mux_playback_id || null,
            mux_media_url: recording.mux_media_url || null,
            recordingHighlights,
          },
        };
      }),
    );
  }

  /**
   * Resolves a share token into a viewer-friendly payload (no auth required).
   * The mobile app uses this when a user follows a `https://.../shared/media/<token>` link
   * to land on the Highlights screen. If a user is logged in we also stamp a `SharedRecording`
   * row so the recording shows up under their "Shared with me" tab.
   */
  async resolveShareToken(
    shareToken: string,
    viewerUserId: string | null,
  ): Promise<{
    recording_id: string;
    owner_id: string;
    mux_playback_id: string | null;
    mux_media_url: string | null;
    duration_seconds: number | null;
    start_time: Date | null;
    end_time: Date | null;
    turf_name: string | null;
    owner_name: string | null;
    status: string | null;
  } | null> {
    const recording = await this.recordingRepositoryForMedia.findOne({
      where: { share_token: shareToken },
      relations: ['turf', 'user'],
    });

    if (!recording) return null;

    if (viewerUserId && viewerUserId !== recording.userId) {
      const existing = await this.sharedRecordingRepository.findOne({
        where: {
          recording_id: recording.id,
          shared_with_user_id: viewerUserId,
        },
      });
      if (!existing) {
        try {
          await this.sharedRecordingRepository.save({
            recording_id: recording.id,
            shared_with_user_id: viewerUserId,
          });
        } catch (e) {
          this.logger.warn(
            `Failed to stamp SharedRecording for token ${shareToken}: ${e?.message || e}`,
          );
        }
      }
    }

    let durationSeconds: number | null = null;
    if (recording.startTime && recording.endTime) {
      durationSeconds = Math.max(
        0,
        Math.floor(
          (new Date(recording.endTime).getTime() -
            new Date(recording.startTime).getTime()) /
            1000,
        ),
      );
    }

    return {
      recording_id: recording.id,
      owner_id: recording.userId,
      mux_playback_id: recording.mux_playback_id ?? null,
      mux_media_url: recording.mux_media_url ?? null,
      duration_seconds: durationSeconds,
      start_time: this.normalizeIstTimestamp(recording.startTime),
      end_time: this.normalizeIstTimestamp(recording.endTime),
      turf_name: recording.turf?.name ?? null,
      owner_name:
        (recording as any)?.user?.name ??
        (recording as any)?.user?.full_name ??
        null,
      status: recording.status ?? null,
    };
  }

  /** Count highlight moments from venue button presses (includes pending / processing). */
  async countButtonHighlightMomentsForRecording(
    recordingId: string,
    userId: string,
  ): Promise<{ count: number }> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      select: { id: true, userId: true },
    });
    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }
    if (recording.userId !== userId) {
      throw new ForbiddenException('You do not have access to this recording.');
    }
    const count = await this.recordingHighlightsRepository.count({
      where: { recordingId },
    });
    return { count };
  }

  /**
   * Returns ready highlights for a single recording, shaped for the mobile Highlights screen.
   */
  async getReadyHighlightsForRecording(
    recordingId: string,
    viewerUserId?: string | null,
  ): Promise<
    Array<{
      id: string;
      relative_timestamp: string | null;
      button_click_timestamp: Date;
      playback_id: string | null;
      mux_public_playback_url: string | null;
      thumbnail_url: string | null;
      status: string;
      likesCount: number;
      viewerLiked: boolean;
      viewerSaved: boolean;
    }>
  > {
    const rows = await this.recordingHighlightsRepository.find({
      where: { recordingId },
      order: { processing_order: 'ASC', createdAt: 'ASC' },
    });

    /** Include mux-ready clips stuck in `clip_created` (webhook sometimes never flips to `ready`). */
    const filtered = rows.filter((h) => {
      const st = String(h.status ?? '').toLowerCase();
      if (
        st === HIGHLIGHT_STATUS.FAILED ||
        st === HIGHLIGHT_STATUS.PERMANENTLY_FAILED
      ) {
        return false;
      }
      const hasStream =
        Boolean(h.playback_id?.trim?.()) || Boolean(h.mux_public_playback_url);
      if (!hasStream) return false;
      return (
        st === HIGHLIGHT_STATUS.READY || st === HIGHLIGHT_STATUS.CLIP_CREATED
      );
    });

    const ids = filtered.map((h) => h.id);
    const viewer =
      await this.recordingHighlightEngagementService.viewerStateMap(
        viewerUserId,
        ids,
      );

    return filtered.map((h) => {
      const v = viewer.get(h.id);
      return {
        id: h.id,
        relative_timestamp: h.relative_timestamp ?? null,
        button_click_timestamp: h.button_click_timestamp,
        playback_id: h.playback_id ?? null,
        mux_public_playback_url:
          h.mux_public_playback_url ??
          (h.playback_id
            ? `https://stream.mux.com/${h.playback_id}.m3u8`
            : null),
        thumbnail_url: h.playback_id
          ? `https://image.mux.com/${h.playback_id}/thumbnail.jpg?time=2`
          : null,
        status: h.status ?? 'unknown',
        likesCount: Number(h.likesCount ?? 0),
        viewerLiked: v?.liked ?? false,
        viewerSaved: v?.saved ?? false,
      };
    });
  }

  /**
   * Constructs a public Mux URL for a given recording.
   *
   * @param recordingId The ID of the recording.
   * @returns An object containing the public Mux URL, or null if the playback ID is not available.
   * @throws NotFoundException if the recording is not found.
   */
  async getMuxPublicUrl(
    recordingId: string,
  ): Promise<{ publicUrl: string } | null> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      select: ['id', 'mux_playback_id'],
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${recordingId} not found.`,
      );
    }

    if (!recording.mux_playback_id) {
      this.logger.warn(
        `Mux playback ID not available for recording ${recordingId}`,
      );
      return null;
    }

    const publicUrl = `https://stream.mux.com/${recording.mux_playback_id}.m3u8`;
    return { publicUrl };
  }

  async processHighlight(
    highlightId: string,
    userId: string,
  ): Promise<{
    success: boolean;
    highlightId: string;
    s3Path?: string;
    bucketName?: string;
    signedUrl?: string;
    message: string;
  }> {
    try {
      this.logger.log(`Processing highlight ${highlightId} for user ${userId}`);

      // Find highlight data with recording and user information
      const highlight = await this.recordingHighlightsRepository.findOne({
        where: { id: highlightId },
        relations: ['recording', 'recording.user'],
      });

      if (!highlight) {
        throw new NotFoundException(
          `Highlight with ID ${highlightId} not found`,
        );
      }

      const recordingId = highlight.recordingId;
      if (!recordingId) {
        throw new BadRequestException(
          'Highlight is missing recording association',
        );
      }
      const entitlementsBypassed =
        process.env.HIGHLIGHT_EXPORT_BACKFILL_SKIP_ENTITLEMENT === 'true';
      if (entitlementsBypassed) {
        this.logger.warn(
          `HIGHLIGHT_EXPORT_BACKFILL_SKIP_ENTITLEMENT is set — skipping unlock check for highlight ${highlightId}`,
        );
      }
      if (
        !entitlementsBypassed &&
        !(await this.paymentRestrictionService.hasCompletedRecordingOrHighlightAccess(
          userId,
          recordingId,
        ))
      ) {
        throw new ForbiddenException(
          'Unlock this recording to export and share highlights.',
        );
      }

      // Check if highlight already has S3 path - if yes, generate signed URL and return
      if (highlight.s3path && highlight.bucketName) {
        this.logger.log(
          `Highlight ${highlightId} already processed, generating signed URL`,
        );

        const signedUrl = await this.fileServiceService.getSignedUrlFromS3(
          highlight.bucketName,
          highlight.s3path,
        );

        if (!this.isProgressiveMp4ExportUrl(signedUrl)) {
          this.logger.warn(
            `S3 signed URL for ${highlightId} does not look like a progressive MP4; re-run export`,
          );
          return {
            success: false,
            highlightId,
            message:
              'Stored export URL is not valid for sharing. Try again to re-run conversion, or run a backfill script.',
          };
        }

        return this.coerceHighlightShareProcessResult(highlightId, {
          success: true,
          highlightId: highlightId,
          s3Path: highlight.s3path,
          bucketName: highlight.bucketName,
          signedUrl: signedUrl,
          message: 'Highlight already processed, signed URL generated',
        });
      }

      /** Force export strategy here while testing (ignores env). Set to `null` before shipping. */
      const HIGHLIGHT_MP4_EXPORT_STRATEGY_OVERRIDE:
        | 'mux_static'
        | 'mux_then_lambda'
        | 'lambda'
        | null = 'mux_static';

      const mp4ExportStrategy =
        HIGHLIGHT_MP4_EXPORT_STRATEGY_OVERRIDE ??
        (process.env.HIGHLIGHT_MP4_EXPORT_STRATEGY || 'mux_then_lambda');
      if (
        mp4ExportStrategy === 'mux_static' ||
        mp4ExportStrategy === 'mux_then_lambda'
      ) {
        const muxStatic = await this.tryMuxStaticMp4SignedUrl(highlight);
        if (muxStatic.kind === 'err') {
          if (mp4ExportStrategy === 'mux_static') {
            return {
              success: false,
              highlightId,
              message: muxStatic.message,
            };
          }
        } else {
          return this.coerceHighlightShareProcessResult(highlightId, {
            success: true,
            highlightId,
            signedUrl: muxStatic.signedUrl,
            message: 'Highlight export URL (Mux static MP4)',
          });
        }
      }

      // Check if user is authorized to process this highlight
      // if (highlight.recording.userId !== userId) {
      //   throw new ForbiddenException(
      //     'User not authorized to process this highlight',
      //   );
      // }

      // Check if highlight has required data for processing.
      // Fallback to a direct Mux URL when only playback_id is present.
      const muxUrl =
        highlight.mux_public_playback_url ||
        (highlight.playback_id
          ? `https://stream.mux.com/${highlight.playback_id}.m3u8`
          : undefined);
      if (!muxUrl) {
        throw new BadRequestException(
          'Highlight does not have a Mux playback URL for processing',
        );
      }

      // Create folder path: userID/recordingID/highlightID
      const folderPath = `highlights/${userId}/${highlight.recordingId}/${highlightId}`;
      // const fileName = `highlight_${highlightId}.mp4`;
      const uploadS3Path = `${folderPath}/`;

      // Get bucket name from environment or use default pattern
      const bucketName =
        process.env.S3_BUCKET_NAME ||
        `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;

      this.logger.log(
        `Created S3 path: ${uploadS3Path} in bucket: ${bucketName}`,
      );

      // Prepare Lambda invocation payload
      const lambdaPayload = {
        muxUrl,
        muxAssetId: highlight.asset_id,
        uploadS3Path: uploadS3Path,
        bucketName: bucketName,
        quality: 'medium', // Default quality, could be made configurable
      };

      this.logger.log(`Invoking Lambda with payload:`, lambdaPayload);

      // Get Lambda function name from environment
      const lambdaFunctionName =
        process.env.MUX_CONVERTER_LAMBDA_FUNCTION_NAME ||
        `fieldflicks-${process.env.ENVIRONMENT || 'dev'}-m3u8-converter`;

      // Invoke Lambda function
      const invokeCommand = new InvokeCommand({
        FunctionName: lambdaFunctionName,
        Payload: JSON.stringify(lambdaPayload),
      });

      const lambdaResponse = await this.lambdaClient.send(invokeCommand);
      const rawBody = lambdaResponse.Payload
        ? new TextDecoder().decode(lambdaResponse.Payload)
        : '{}';

      let responsePayload: {
        success?: boolean;
        message?: string;
        error?: string;
        data?: {
          signedUrl?: string;
          s3Path?: string;
          bucketName?: string;
        };
      };
      try {
        responsePayload = JSON.parse(rawBody);
      } catch {
        this.logger.error(
          `Invalid Lambda payload for ${highlightId}: ${rawBody?.slice(0, 500)}`,
        );
        return {
          success: false,
          highlightId,
          message:
            'Video converter returned an invalid response. Check Lambda logs and MUX_CONVERTER_LAMBDA_FUNCTION_NAME.',
        };
      }

      if (lambdaResponse.FunctionError) {
        const errMsg =
          typeof (responsePayload as { errorMessage?: string }).errorMessage ===
          'string'
            ? (responsePayload as { errorMessage: string }).errorMessage
            : responsePayload?.message ||
              responsePayload?.error ||
              'Lambda raised an error';
        this.logger.error(
          `Lambda FunctionError for ${highlightId}: ${lambdaResponse.FunctionError}`,
          errMsg,
        );
        return {
          success: false,
          highlightId,
          message: `Video converter error: ${errMsg}`,
        };
      }

      this.logger.log(`Lambda response: ${JSON.stringify(responsePayload)}`);

      if (responsePayload.success && responsePayload.data) {
        const signedUrl = responsePayload.data.signedUrl;
        if (!this.isProgressiveMp4ExportUrl(signedUrl)) {
          this.logger.warn(
            `Lambda returned success but signedUrl is not an MP4 export URL for ${highlightId}`,
          );
          return {
            success: false,
            highlightId,
            message:
              'Video converter did not return a downloadable MP4. Check the mux-m3u8-converter Lambda and S3 upload.',
          };
        }

        await this.recordingHighlightsRepository.update(highlightId, {
          bucketName: responsePayload.data.bucketName,
          s3path: responsePayload.data.s3Path,
        });

        return this.coerceHighlightShareProcessResult(highlightId, {
          success: true,
          highlightId: highlightId,
          s3Path: responsePayload.data.s3Path,
          bucketName: responsePayload.data.bucketName,
          signedUrl,
          message: 'Highlight processed successfully',
        });
      }

      const failureMsg =
        responsePayload.message ||
        responsePayload.error ||
        'Failed to convert highlight to MP4';
      this.logger.warn(
        `Lambda MP4 export failed for ${highlightId}: ${failureMsg}`,
      );
      return {
        success: false,
        highlightId,
        message: failureMsg,
      };
    } catch (error) {
      this.logger.error(`Error processing highlight ${highlightId}:`, error);

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const msg = error?.message || 'Unknown error occurred';
      return {
        success: false,
        highlightId,
        message: `MP4 export failed: ${msg}. Watching in the app still works ("Ready" is playback, not the share file). Verify AWS Lambda, IAM, S3 bucket, and MUX_CONVERTER_LAMBDA_FUNCTION_NAME.`,
      };
    }
  }

  /**
   * `/highlight/:id/process` must only return success when `signedUrl` is a single-file
   * progressive download. Some code paths (or older deployments) incorrectly return HLS
   * (.m3u8) with success=true; clients cannot share that as one MP4 file.
   */
  private coerceHighlightShareProcessResult(
    highlightId: string,
    result: {
      success: boolean;
      highlightId: string;
      s3Path?: string;
      bucketName?: string;
      signedUrl?: string;
      message: string;
    },
  ): {
    success: boolean;
    highlightId: string;
    s3Path?: string;
    bucketName?: string;
    signedUrl?: string;
    message: string;
  } {
    if (
      result.success &&
      result.signedUrl &&
      !this.isProgressiveMp4ExportUrl(result.signedUrl)
    ) {
      this.logger.warn(
        `Rejecting highlight process result: success=true but signedUrl is not an MP4 export (highlightId=${highlightId} url=${result.signedUrl.slice(0, 120)})`,
      );
      return {
        success: false,
        highlightId,
        message:
          'A downloadable MP4 for this highlight is not ready yet (the server returned a playback-only stream). You can still watch the clip in the app. Try sharing again in a few minutes, or contact support with your highlight id.',
      };
    }
    return result;
  }

  /** URLs suitable for FileSystem.downloadAsync as a single file — not Mux HLS. */
  private isProgressiveMp4ExportUrl(url: string | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    if (u.includes('.m3u8')) return false;
    // Mux static renditions are progressive MP4 at stream.mux.com/{playbackId}/highest.mp4
    if (u.includes('stream.mux.com') && !u.includes('.mp4')) return false;
    if (!u.includes('.mp4')) return false;
    return true;
  }

  /**
   * Ask Mux to generate `highest` static MP4 for an existing clip asset (same creds as API).
   * Used so legacy highlights work without Lambda/S3 or manual dashboard steps.
   */
  private async requestMuxHighestStaticRendition(
    assetId: string,
    muxTokenId: string,
    muxTokenSecret: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await axios.post(
        `${MUX_API_BASE_URL}/video/v1/assets/${encodeURIComponent(assetId)}/static-renditions`,
        { resolution: 'highest' },
        {
          auth: { username: muxTokenId, password: muxTokenSecret },
          validateStatus: (s) =>
            (s >= 200 && s < 300) || s === 409 || s === 422 || s === 400,
        },
      );
      if (
        res.status === 400 &&
        muxIsStaticRenditionAlreadyDefinedResponse(res.data)
      ) {
        return { ok: true };
      }
      if (res.status === 400) {
        this.logger.warn(
          `Mux static-rendition POST bad request (400) for asset ${assetId}`,
          res.data,
        );
        return {
          ok: false,
          message:
            'Mux did not accept this static MP4 request. The asset may already have a conflicting rendition.',
        };
      }
      if (res.status === 422) {
        const snippet =
          typeof res.data === 'string'
            ? res.data.slice(0, 300)
            : JSON.stringify(res.data ?? '').slice(0, 300);
        this.logger.warn(
          `Mux static-rendition POST rejected (422) for asset ${assetId}: ${snippet}`,
        );
        return {
          ok: false,
          message:
            'Mux rejected static MP4 for this asset (often legacy mp4_support or asset type). Check Mux dashboard or docs.',
        };
      }
      if ((res.status >= 200 && res.status < 300) || res.status === 409) {
        return { ok: true };
      }
      this.logger.warn(
        `Mux static-rendition POST unexpected status ${res.status} for asset ${assetId}`,
        res.data,
      );
      return {
        ok: false,
        message:
          'Mux did not accept static MP4 generation for this clip. It may be unsupported or still processing.',
      };
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: unknown };
      };
      const status = ax.response?.status;
      if (
        status === 400 &&
        muxIsStaticRenditionAlreadyDefinedResponse(ax.response?.data)
      ) {
        return { ok: true };
      }
      if (status === 422) {
        this.logger.warn(
          `Mux static-rendition POST rejected (422) for asset ${assetId}`,
          ax.response?.data,
        );
        return {
          ok: false,
          message:
            'Mux rejected static MP4 for this asset (often legacy mp4_support or asset type).',
        };
      }
      if (status === 409) {
        return { ok: true };
      }
      this.logger.warn(
        `Mux static-rendition POST failed for asset ${assetId}`,
        err,
      );
      return {
        ok: false,
        message: 'Could not start MP4 generation on Mux. Try again later.',
      };
    }
  }

  /**
   * Build a downloadable Mux static-rendition MP4 URL using only Mux API credentials
   * (no Lambda/S3). Creates `highest` static renditions on demand for existing assets.
   */
  private async tryMuxStaticMp4SignedUrl(
    highlight: RecordingHighlights,
  ): Promise<
    { kind: 'ok'; signedUrl: string } | { kind: 'err'; message: string }
  > {
    const assetId = highlight.asset_id?.trim();
    const playbackId = highlight.playback_id?.trim();
    if (!assetId || !playbackId) {
      return {
        kind: 'err',
        message:
          'Clip metadata is missing. Share/export as MP4 needs a processed highlight clip from Mux.',
      };
    }

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;
    if (!muxTokenId || !muxTokenSecret) {
      return { kind: 'err', message: 'Mux credentials not configured.' };
    }

    const autoRequest =
      process.env.HIGHLIGHT_MUX_AUTO_REQUEST_STATIC_MP4 !== 'false';

    const readAsset = async (): Promise<Record<string, unknown> | null> => {
      try {
        const response = await axios.get(
          `${MUX_API_BASE_URL}/video/v1/assets/${encodeURIComponent(assetId)}`,
          { auth: { username: muxTokenId, password: muxTokenSecret } },
        );
        return response.data?.data ?? null;
      } catch (err) {
        this.logger.warn(
          `Mux asset fetch failed for highlight ${highlight.id} asset ${assetId}`,
          err,
        );
        return null;
      }
    };

    let asset = await readAsset();
    if (!asset) {
      return { kind: 'err', message: 'Could not load this clip from Mux.' };
    }

    const resolveFromRenditions = (
      raw: unknown,
    ):
      | { stage: 'ready'; name: string }
      | { stage: 'preparing' }
      | { stage: 'need_request' }
      | { stage: 'dead'; message: string } => {
      const list = muxStaticRenditionFileRows(raw);
      const bucket = muxStaticRenditionsBucketStatus(raw);
      const mp4Rows = list.filter(
        (r) =>
          r &&
          typeof r === 'object' &&
          String((r as { ext?: string }).ext || '') === 'mp4',
      ) as Array<Record<string, unknown>>;

      if (mp4Rows.length === 0) {
        if (bucket === 'preparing') {
          return { stage: 'preparing' };
        }
        if (bucket === 'errored') {
          return {
            stage: 'dead',
            message:
              'Mux could not generate an MP4 for this clip. Try sharing from a newer highlight.',
          };
        }
        return { stage: 'need_request' };
      }

      const ready = mp4Rows.find(
        (r) => String(r['status'] || '') === 'ready',
      ) as { name?: string } | undefined;
      if (ready?.name) {
        return { stage: 'ready', name: ready.name };
      }

      if (
        mp4Rows.some((r) =>
          ['preparing', 'waiting'].includes(String(r['status'] || '')),
        )
      ) {
        return { stage: 'preparing' };
      }

      const errored = mp4Rows.every(
        (r) => String(r['status'] || '') === 'errored',
      );
      if (errored) {
        return {
          stage: 'dead',
          message:
            'Mux could not generate an MP4 for this clip. Try sharing from a newer highlight.',
        };
      }

      return { stage: 'need_request' };
    };

    let decision = resolveFromRenditions(asset['static_renditions']);

    if (decision.stage === 'dead') {
      return { kind: 'err', message: decision.message };
    }

    if (decision.stage === 'preparing') {
      return {
        kind: 'err',
        message:
          'MP4 file is still being prepared on Mux. Try again in a few minutes.',
      };
    }

    if (decision.stage === 'need_request') {
      if (!autoRequest) {
        return {
          kind: 'err',
          message:
            'MP4 download is not enabled for this clip yet. Set HIGHLIGHT_MUX_AUTO_REQUEST_STATIC_MP4=true (default) or add static renditions in Mux.',
        };
      }
      const req = await this.requestMuxHighestStaticRendition(
        assetId,
        muxTokenId,
        muxTokenSecret,
      );
      if (req.ok === false) {
        return { kind: 'err', message: req.message };
      }
      asset = await readAsset();
      if (!asset) {
        return { kind: 'err', message: 'Could not load this clip from Mux.' };
      }
      decision = resolveFromRenditions(asset['static_renditions']);
      if (decision.stage === 'ready' && decision.name) {
        /* fall through to URL build below */
      } else if (decision.stage === 'preparing') {
        return {
          kind: 'err',
          message:
            'MP4 generation has started on Mux. Try sharing again in a few minutes.',
        };
      } else if (decision.stage === 'dead') {
        return { kind: 'err', message: decision.message };
      } else {
        return {
          kind: 'err',
          message:
            'MP4 generation has started on Mux. Try sharing again in a few minutes.',
        };
      }
    }

    if (decision.stage !== 'ready' || !decision.name) {
      return {
        kind: 'err',
        message:
          'No ready MP4 rendition is available for this clip yet. Try again shortly.',
      };
    }

    let url = `https://stream.mux.com/${playbackId}/${decision.name}`;
    const signed = await this.muxService.signPlaybackToken(playbackId);
    if (signed?.token) {
      url = `${url}?token=${encodeURIComponent(signed.token)}`;
    }

    if (!this.isProgressiveMp4ExportUrl(url)) {
      return {
        kind: 'err',
        message: 'Could not build a valid MP4 export URL.',
      };
    }

    return { kind: 'ok', signedUrl: url };
  }

  /**
   * One-hour tolerance applied to BOTH ends of the user-supplied time window
   * before overlap testing. Users rarely remember a start time more accurately
   * than "around 5 PM", so a 4–6 PM window on input becomes a 3–7 PM search.
   */
  private readonly FIND_RECORDING_TIME_TOLERANCE_MS = 60 * 60 * 1000;

  /**
   * Build (and execute) the recording search used by both the new
   * search-only `findRecordings` flow and the legacy `findAndClaim` path.
   *
   * Matching semantics:
   *   - Recording must belong to ANY of the supplied `turfIds` (the picked
   *     venue plus every duplicate-name alias).
   *   - Court / camera are intentionally ignored for matching (UX request:
   *     "search by arena + time + phone only"), so all cameras at the venue
   *     are eligible.
   *   - Time window is padded by ±1h before overlap testing.
   *   - Phone matches the last 10 digits exactly against the digits-only
   *     phone number of the recording's creator.
   */
  private async runRecordingSearch(args: {
    turfIds: string[];
    date: string;
    startTime: string;
    endTime: string;
    phoneLast10: string;
  }): Promise<Recording[]> {
    const { turfIds, date, startTime, endTime, phoneLast10 } = args;

    if (!Array.isArray(turfIds) || turfIds.length === 0) {
      throw new BadRequestException('At least one turfId is required');
    }

    // Mobile sends local venue date/time (IST). Parse with explicit offset so
    // server timezone differences cannot shift the search window.
    const startTimestamp = new Date(`${date}T${startTime}:00+05:30`);
    const endTimestamp = new Date(`${date}T${endTime}:00+05:30`);

    if (isNaN(startTimestamp.getTime()) || isNaN(endTimestamp.getTime())) {
      throw new BadRequestException('Invalid date or time format');
    }
    if (!/^\d{10}$/.test(phoneLast10 ?? '')) {
      throw new BadRequestException('phoneLast10 must be exactly 10 digits');
    }

    const tol = this.FIND_RECORDING_TIME_TOLERANCE_MS;
    const paddedStart = new Date(startTimestamp.getTime() - tol);
    const paddedEnd = new Date(endTimestamp.getTime() + tol);

    if (paddedEnd <= paddedStart) {
      throw new BadRequestException('endTime must be after startTime');
    }

    const qb = this.recordingRepository
      .createQueryBuilder('recording')
      .leftJoinAndSelect('recording.user', 'user')
      .leftJoinAndSelect('recording.turf', 'turf')
      .leftJoinAndSelect('recording.camera', 'camera')
      .where('recording.turfId IN (:...turfIds)', { turfIds })
      .andWhere('recording.startTime >= :paddedStart', { paddedStart })
      .andWhere('recording.startTime < :paddedEnd', { paddedEnd })
      .andWhere(
        '(recording.endTime IS NULL OR recording.endTime > :paddedStart)',
        { paddedStart },
      )
      .andWhere(
        "RIGHT(REGEXP_REPLACE(COALESCE(user.phone_number, ''), '\\D', '', 'g'), 10) = :phoneLast10",
        { phoneLast10 },
      );

    return qb.getMany();
  }

  /**
   * Search-only endpoint backing `POST /recording/find`.
   *
   * Returns every recording matching the venue (and its alias turfs), the
   * picked court number, a ±1h time window, and the last-10-digit phone
   * filter. Does NOT create a SharedRecording row — the requester picks one
   * from the result list and explicitly claims it via `POST
   * /recording/claim/:recordingId`.
   */
  async findRecordings(dto: FindRecordingsDto): Promise<Recording[]> {
    return this.runRecordingSearch({
      turfIds: dto.turfIds,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      phoneLast10: dto.phoneLast10,
    });
  }

  /**
   * Explicit per-recording claim — backing `POST /recording/claim/:id`.
   *
   * Creates a SharedRecording row so the recording appears in the requester's
   * "My Recordings" / "Shared with me" lists. Idempotent — re-claiming is a
   * no-op. Payment lock is NOT touched here: claim only makes the recording
   * visible. Whether playback is unlocked is governed exclusively by
   * PaymentRestrictionService (group-unlock semantics).
   */
  async claimRecording(
    recordingId: string,
    requestingUserId: string,
  ): Promise<{ claimed: boolean; reason: string; recording: Recording }> {
    if (!recordingId) {
      throw new BadRequestException('recordingId is required');
    }
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      relations: ['user', 'turf', 'camera'],
    });
    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    if (recording.userId === requestingUserId) {
      return {
        claimed: true,
        reason: 'Requester already owns this recording',
        recording,
      };
    }

    const existingShare = await this.sharedRecordingRepository.findOne({
      where: {
        recording_id: recording.id,
        shared_with_user_id: requestingUserId,
      },
    });
    if (existingShare) {
      return {
        claimed: true,
        reason: 'Already shared with this user',
        recording,
      };
    }

    const share = this.sharedRecordingRepository.create({
      recording_id: recording.id,
      shared_with_user_id: requestingUserId,
    });
    await this.sharedRecordingRepository.save(share);

    return { claimed: true, reason: 'Shared with user', recording };
  }

  /**
   * Legacy combined search-and-auto-claim. Kept for backward compatibility
   * with older mobile builds. New clients use `findRecordings` + an explicit
   * `claimRecording` so the user picks the right match before it's claimed.
   */
  async findAndClaimRecording(
    dto: FindAndClaimRecordingDto,
    requestingUserId: string,
  ): Promise<Recording[]> {
    const matches = await this.runRecordingSearch({
      turfIds: [dto.turfId],
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      phoneLast10: dto.phoneLast10,
    });
    if (matches.length === 0) return [];

    for (const match of matches) {
      if (match.userId === requestingUserId) continue;
      const existingShare = await this.sharedRecordingRepository.findOne({
        where: {
          recording_id: match.id,
          shared_with_user_id: requestingUserId,
        },
      });
      if (!existingShare) {
        const share = this.sharedRecordingRepository.create({
          recording_id: match.id,
          shared_with_user_id: requestingUserId,
        });
        await this.sharedRecordingRepository.save(share);
      }
    }
    return matches;
  }
}
