import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { ECronExpressionEum } from 'src/constant/cron-expression.enum';
import { Recording } from '../entities/recording.entity';
import { RecordingHighlights } from '../entities/recording-highlights.entity';
import { HIGHLIGHT_STATUS } from 'src/constant/constant';
import { RecordingService } from './recording.service';
import { RecordingHighlightsService } from './recording-highlight.service';
import { S3HighlightSyncService } from './s3-highlight-sync.service';
import { FileServiceService } from 'src/file-service/file-service.service';
import {
  readRecordingNvrChannel,
  resolveNvrChannelsForCamera,
} from 'src/utils/nvr-channels.util';
import {
  isBotanicalVenueLabel,
  resolveBotanicalLogicalCourtNumber,
} from 'src/utils/botanical-logical-court.util';
import { botanicalNvrChannels } from 'src/utils/live-stream-slots.util';

type HealSummary = {
  cleanedFailed: number;
  deletedPartialKeys: number;
  deletedOrphanHighlights: number;
  healCandidates: number;
  highlightsAttached: number;
  muxRetries: number;
  skippedFailed: number;
};

/**
 * Periodic self-heal: drop partial failed extraction junk, then link S3 highlights
 * for playable sessions only (never list the highlights bucket for dead extractions).
 */
@Injectable()
export class HighlightGapHealService {
  private readonly logger = new Logger(HighlightGapHealService.name);
  private running = false;

  private static readonly LOOKBACK_DAYS = 14;

  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly recordingService: RecordingService,
    private readonly recordingHighlightsService: RecordingHighlightsService,
    private readonly s3HighlightSyncService: S3HighlightSyncService,
    private readonly fileServiceService: FileServiceService,
  ) {}

  /** Every 3 hours — audit gaps, clean failed partials, re-link S3 highlights. */
  @Cron(ECronExpressionEum.EVERY_3_HOURS)
  async scheduledHeal(): Promise<void> {
    await this.runHealCycle('cron');
  }

  async runHealCycle(trigger = 'manual'): Promise<HealSummary> {
    if (this.running) {
      this.logger.warn(`highlight gap heal skipped — previous run in flight`);
      return {
        cleanedFailed: 0,
        deletedPartialKeys: 0,
        deletedOrphanHighlights: 0,
        healCandidates: 0,
        highlightsAttached: 0,
        muxRetries: 0,
        skippedFailed: 0,
      };
    }

    this.running = true;
    const summary: HealSummary = {
      cleanedFailed: 0,
      deletedPartialKeys: 0,
      deletedOrphanHighlights: 0,
      healCandidates: 0,
      highlightsAttached: 0,
      muxRetries: 0,
      skippedFailed: 0,
    };

    try {
      this.logger.log(`Highlight gap heal started (${trigger})`);
      const since = new Date(
        Date.now() -
          HighlightGapHealService.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      );

      const recent = await this.recordingRepo.find({
        where: { startTime: MoreThan(since) },
        relations: ['camera', 'camera.turf'],
        order: { startTime: 'DESC' },
      });

      const failed = recent.filter(
        (rec) =>
          String(rec.status ?? '').toLowerCase() === 'failed' &&
          !this.recordingService.isRecordingMuxPlayable(rec),
      );

      for (const rec of failed) {
        summary.skippedFailed += 1;
        const cleaned = await this.cleanupFailedPartialExtract(rec);
        summary.cleanedFailed += 1;
        summary.deletedPartialKeys += cleaned.deletedKeys;
        summary.deletedOrphanHighlights += cleaned.deletedHighlights;
      }

      const healTargets = recent.filter((rec) =>
        this.isPrimaryChannelRecording(rec),
      );
      const playableTargets = healTargets.filter((rec) =>
        this.recordingService.isRecordingMuxPlayable(rec),
      );

      summary.healCandidates = playableTargets.length;

      const cachePairs = this.collectCourtCamPairs(playableTargets);
      const highlightCache =
        cachePairs.length > 0
          ? await this.s3HighlightSyncService.buildHighlightCache(cachePairs)
          : undefined;

      for (const rec of playableTargets) {
        if (!rec.cameraId || !rec.startTime || !rec.endTime) continue;
        try {
          const attached =
            await this.recordingHighlightsService.attachHighlightsInTimeWindow(
              rec.id,
              rec.cameraId,
              rec.startTime,
              rec.endTime,
              highlightCache,
            );
          summary.highlightsAttached += attached;
        } catch (err) {
          this.logger.warn(
            `Highlight attach failed for ${rec.id}: ${(err as Error)?.message || err}`,
          );
        }
      }

      const stuckExtracting = recent.filter(
        (rec) =>
          String(rec.status ?? '').toLowerCase() === 'extracting' &&
          !this.recordingService.isRecordingMuxPlayable(rec) &&
          rec.s3Path,
      );
      for (const rec of stuckExtracting) {
        try {
          const result = await this.recordingService.retryMuxIngestion(rec.id);
          if (result.ok) summary.muxRetries += 1;
        } catch {
          // retryMuxIngestion throws on missing source — cleanup next cycle
        }
      }

      this.logger.log(`Highlight gap heal complete (${trigger})`, summary);
      return summary;
    } catch (err) {
      this.logger.error(
        `Highlight gap heal failed: ${(err as Error)?.message || err}`,
      );
      throw err;
    } finally {
      this.running = false;
    }
  }

  private isPrimaryChannelRecording(rec: Recording): boolean {
    if (!rec.camera || !rec.startTime || !rec.endTime) return false;

    const camera = rec.camera;
    const meta = (rec.metadata ?? {}) as Record<string, unknown>;
    const nvrChannels = resolveNvrChannelsForCamera(camera);
    const logicalCourt = isBotanicalVenueLabel(camera.turf?.name)
      ? resolveBotanicalLogicalCourtNumber(camera)
      : camera.court_number;
    const defaultChannel =
      logicalCourt != null && Number(logicalCourt) > 0
        ? Number(logicalCourt)
        : camera.court_number && camera.court_number > 0
          ? camera.court_number
          : nvrChannels[0];
    const channelNumber = readRecordingNvrChannel(meta, defaultChannel);
    return channelNumber === nvrChannels[0];
  }

  private collectCourtCamPairs(
    recordings: Recording[],
  ): Array<{ court: number; nvrCam: number }> {
    const seen = new Set<string>();
    const pairs: Array<{ court: number; nvrCam: number }> = [];

    for (const rec of recordings) {
      const camera = rec.camera;
      if (!camera) continue;

      const court = isBotanicalVenueLabel(camera.turf?.name)
        ? resolveBotanicalLogicalCourtNumber(camera)
        : camera.court_number;
      if (court == null) continue;

      const botanicalMap = botanicalNvrChannels(court);
      const nvrCams =
        isBotanicalVenueLabel(camera.turf?.name) && botanicalMap
          ? [botanicalMap.ch1, botanicalMap.ch2]
          : this.s3HighlightSyncService.nvrChannelsForCamera(camera);

      for (const nvrCam of nvrCams) {
        const key = this.s3HighlightSyncService.highlightCacheKey(
          court,
          nvrCam,
        );
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ court, nvrCam });
      }
    }

    return pairs;
  }

  /** Remove orphan recording MP4s and pending highlight rows for failed extractions. */
  private async cleanupFailedPartialExtract(rec: Recording): Promise<{
    deletedKeys: number;
    deletedHighlights: number;
  }> {
    const bucket = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';
    let deletedKeys = 0;

    const prefix = `recordings/${rec.id}_`;
    const keys = await this.fileServiceService.listObjectKeysWithPrefix(prefix);
    for (const key of keys) {
      try {
        await this.fileServiceService.deleteFileFormS3(bucket, key);
        deletedKeys += 1;
      } catch (err) {
        this.logger.warn(
          `Could not delete partial S3 key ${key}: ${(err as Error)?.message || err}`,
        );
      }
    }

    const meta = (rec.metadata ?? {}) as Record<string, unknown>;
    await this.recordingRepo.update(rec.id, {
      s3Path: null,
      mux_asset_id: null,
      mux_playback_id: null,
      mux_media_url: null,
      metadata: {
        ...meta,
        expected_s3_key: null,
        mux_upload_id: null,
        partial_cleaned_at: new Date().toISOString(),
      } as Recording['metadata'],
    });

    const orphanRows = await this.dataSource.manager.find(RecordingHighlights, {
      where: {
        recordingId: rec.id,
        status: In([
          HIGHLIGHT_STATUS.PENDING,
          HIGHLIGHT_STATUS.QUEUED,
          HIGHLIGHT_STATUS.PROCESSING,
        ]),
      },
    });
    const toDelete = orphanRows.filter(
      (row) => !row.s3path?.trim() && !row.playback_id?.trim(),
    );
    if (toDelete.length > 0) {
      await this.dataSource.manager.remove(RecordingHighlights, toDelete);
    }

    return { deletedKeys, deletedHighlights: toDelete.length };
  }
}
