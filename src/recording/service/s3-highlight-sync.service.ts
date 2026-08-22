import { Inject, Injectable, Logger } from '@nestjs/common';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AWSS3Bucket } from 'src/constant/providers.constant';
import { HIGHLIGHT_STATUS } from 'src/constant/constant';
import { Camera } from 'src/camera/camera.entity';
import { Recording } from '../entities/recording.entity';
import { RecordingHighlights } from '../entities/recording-highlights.entity';
import {
  buildHighlightPublicUrl,
  highlightCourtCamPrefix,
  parseHighlightS3Key,
} from 'src/utils/s3-highlight-key.util';
import {
  botanicalNvrChannels,
  isBotanicalPiBaseUrl,
  LiveStreamSlot,
} from 'src/utils/live-stream-slots.util';
import { resolveNvrChannelsForCamera } from 'src/utils/nvr-channels.util';
import {
  isBotanicalVenueLabel,
  resolveBotanicalLogicalCourtNumber,
} from 'src/utils/botanical-logical-court.util';

@Injectable()
export class S3HighlightSyncService {
  private readonly logger = new Logger(S3HighlightSyncService.name);
  private readonly bucket =
    process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AWSS3Bucket) private readonly s3: S3Client,
  ) {}

  private resolveCameraSlot(cameraId: string): LiveStreamSlot | null {
    if (cameraId.endsWith('_ch2')) return 2;
    if (cameraId.endsWith('_ch1')) return 1;
    return null;
  }

  /** NVR channel numbers that belong to this logical camera slot. */
  nvrChannelsForCamera(
    camera: Pick<
      Camera,
      'id' | 'name' | 'court_number' | 'raspberryPiBaseUrl'
    > & { turf?: { name?: string | null } | null },
  ): number[] {
    const all = resolveNvrChannelsForCamera(camera);
    const slot = this.resolveCameraSlot(camera.id);
    if (slot === 1) return [all[0]];
    if (slot === 2) return [all[1] ?? all[0]];
    return all;
  }

  async listS3HighlightsForCourtCam(
    court: number,
    nvrCam: number,
  ): Promise<
    Array<{
      key: string;
      windowStart: Date;
      publicUrl: string;
    }>
  > {
    const prefix = highlightCourtCamPrefix(court, nvrCam);
    const results: Array<{
      key: string;
      windowStart: Date;
      publicUrl: string;
    }> = [];
    let continuationToken: string | undefined;

    do {
      const resp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of resp.Contents ?? []) {
        if (!obj.Key) continue;
        const parsed = parseHighlightS3Key(obj.Key);
        if (!parsed) continue;
        results.push({
          key: obj.Key,
          windowStart: parsed.windowStart,
          publicUrl: buildHighlightPublicUrl(obj.Key, this.bucket),
        });
      }

      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return results;
  }

  /**
   * Pull gateway S3 highlights into the target extracted recording when their
   * window start falls inside [startTime, endTime].
   */
  async attachS3HighlightsInTimeWindow(
    targetRecordingId: string,
    cameraId: string,
    startTime: Date,
    endTime: Date,
    formatRelativeTime: (seconds: number) => string,
    calculateRelativeSeconds: (recordingStart: Date, clickTime: Date) => number,
  ): Promise<number> {
    const targetRecording = await this.dataSource.manager.findOne(Recording, {
      where: { id: targetRecordingId },
    });
    if (!targetRecording?.startTime) return 0;

    const camera = await this.dataSource.manager.findOne(Camera, {
      where: { id: cameraId },
      relations: ['turf'],
    });
    if (!camera) return 0;
    if (!camera.court_number && !isBotanicalVenueLabel(camera.turf?.name)) {
      this.logger.debug(
        `S3 highlight sync skipped — camera ${cameraId} has no court_number`,
      );
      return 0;
    }

    const court = isBotanicalVenueLabel(camera.turf?.name)
      ? resolveBotanicalLogicalCourtNumber(camera)
      : camera.court_number;
    const nvrCams = this.nvrChannelsForCamera(camera);

    const existingRows = await this.dataSource.manager.find(
      RecordingHighlights,
      { where: { recordingId: targetRecordingId } },
    );
    const existingS3Paths = new Set(
      existingRows.map((r) => r.s3path).filter(Boolean) as string[],
    );
    const existingClickTimes = new Set(
      existingRows.map((r) => new Date(r.button_click_timestamp).getTime()),
    );

    let maxProcessingOrder =
      existingRows.reduce(
        (max, row) => Math.max(max, row.processing_order ?? 0),
        0,
      ) ?? 0;

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();
    const windowSeconds = Math.floor((endMs - startMs) / 1000);
    if (windowSeconds < 5) return 0;

    let attached = 0;

    for (const nvrCam of nvrCams) {
      const objects = await this.listS3HighlightsForCourtCam(court, nvrCam);
      for (const obj of objects) {
        const clickMs = obj.windowStart.getTime();
        if (clickMs < startMs || clickMs > endMs) continue;
        if (existingS3Paths.has(obj.key)) continue;
        if (existingClickTimes.has(clickMs)) continue;

        const relativeSeconds = calculateRelativeSeconds(
          targetRecording.startTime,
          obj.windowStart,
        );
        if (relativeSeconds < 5 || relativeSeconds > windowSeconds) continue;

        maxProcessingOrder += 1;
        const publicUrl = obj.publicUrl;

        await this.dataSource.manager.save(RecordingHighlights, {
          recordingId: targetRecordingId,
          button_click_timestamp: obj.windowStart,
          relative_timestamp: formatRelativeTime(relativeSeconds),
          status: HIGHLIGHT_STATUS.READY,
          s3path: obj.key,
          mux_public_playback_url: publicUrl,
          playback_id: null,
          asset_id: null,
          source_asset_id: targetRecording.mux_asset_id || null,
          bucketName: this.bucket,
          isClipCreated: true,
          processing_order: maxProcessingOrder,
        });

        existingS3Paths.add(obj.key);
        existingClickTimes.add(clickMs);
        attached += 1;
      }
    }

    if (attached > 0) {
      this.logger.log(
        `Attached ${attached} S3 highlight(s) to recording ${targetRecordingId}`,
        { court, nvrCams, startTime, endTime },
      );
    }

    return attached;
  }

  /** Reverse-map court + NVR cam → camera UUID (Botanical dual-slot courts). */
  async resolveCameraIdForCourtNvrCam(
    court: number,
    nvrCam: number,
  ): Promise<string | null> {
    const cameras = await this.dataSource.manager
      .createQueryBuilder(Camera, 'c')
      .leftJoinAndSelect('c.turf', 'turf')
      .where('c.court_number = :court', { court })
      .getMany();

    if (cameras.length === 0) return null;

    const isBotanicalVenue = cameras.some(
      (c) =>
        (c.turf?.name ?? '').toLowerCase().includes('botanical') ||
        isBotanicalPiBaseUrl(c.raspberryPiBaseUrl),
    );

    if (isBotanicalVenue) {
      const map = botanicalNvrChannels(court);
      if (map) {
        let slot: LiveStreamSlot | null = null;
        if (nvrCam === map.ch1) slot = 1;
        else if (nvrCam === map.ch2) slot = 2;
        if (slot) {
          const slotCam = cameras.find((c) => c.id.endsWith(`_ch${slot}`));
          if (slotCam) return slotCam.id;
        }
      }
    } else {
      const match = cameras.find((c) => c.court_number === nvrCam);
      if (match) return match.id;
    }

    return cameras[0].id;
  }
}
