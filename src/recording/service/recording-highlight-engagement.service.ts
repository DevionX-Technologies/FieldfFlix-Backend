import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RecordingHighlightEngagement } from '../entities/recording-highlight-engagement.entity';
import { RecordingHighlights } from '../entities/recording-highlights.entity';

export type SavedHighlightSummaryDto = {
  recordingId: string;
  highlightId: string;
  relativeTimestamp: string | null;
  muxPublicPlaybackUrl: string | null;
  thumbnailUrl: string | null;
  status: string;
};

/** Persists like / save toggles per user per recording highlight clip. */
@Injectable()
export class RecordingHighlightEngagementService {
  constructor(
    @InjectRepository(RecordingHighlightEngagement)
    private readonly engagementRepo: Repository<RecordingHighlightEngagement>,
    @InjectRepository(RecordingHighlights)
    private readonly highlightsRepo: Repository<RecordingHighlights>,
  ) {}

  private async reloadEngagementRow(
    userId: string,
    highlightId: string,
  ): Promise<RecordingHighlightEngagement | null> {
    return this.engagementRepo.findOne({
      where: { userId, recordingHighlightId: highlightId },
    });
  }

  private async ensureHighlightExists(highlightId: string): Promise<void> {
    const exists = await this.highlightsRepo.exist({ where: { id: highlightId } });
    if (!exists) {
      throw new NotFoundException('Highlight not found');
    }
  }

  async toggleLike(
    userId: string,
    highlightId: string,
  ): Promise<{ liked: boolean; likesCount: number }> {
    await this.ensureHighlightExists(highlightId);

    await this.highlightsRepo.manager.transaction(async (em) => {
      let row = await em.findOne(RecordingHighlightEngagement, {
        where: { userId, recordingHighlightId: highlightId },
      });

      const prev = row?.liked ?? false;
      const next = !prev;
      const delta = next && !prev ? 1 : !next && prev ? -1 : 0;

      if (!row) {
        if (!next) {
          return;
        }
        row = em.create(RecordingHighlightEngagement, {
          userId,
          recordingHighlightId: highlightId,
          liked: true,
          saved: false,
        });
        await em.save(row);
      } else {
        row.liked = next;
        if (!row.liked && !row.saved) {
          await em.remove(row);
        } else {
          await em.save(row);
        }
      }

      if (delta !== 0) {
        await em.query(
          `UPDATE recording_highlights SET likes_count = GREATEST(0, COALESCE(likes_count, 0) + $1) WHERE id = $2`,
          [delta, highlightId],
        );
      }
    });

    const [hFresh, row] = await Promise.all([
      this.highlightsRepo.findOne({
        where: { id: highlightId },
        select: ['id', 'likesCount'],
      }),
      this.reloadEngagementRow(userId, highlightId),
    ]);

    return {
      liked: row?.liked ?? false,
      likesCount: hFresh?.likesCount ?? 0,
    };
  }

  async toggleSave(
    userId: string,
    highlightId: string,
  ): Promise<{ saved: boolean }> {
    await this.ensureHighlightExists(highlightId);

    await this.highlightsRepo.manager.transaction(async (em) => {
      let row = await em.findOne(RecordingHighlightEngagement, {
        where: { userId, recordingHighlightId: highlightId },
      });

      const prev = row?.saved ?? false;
      const next = !prev;

      if (!row) {
        if (!next) {
          return;
        }
        row = em.create(RecordingHighlightEngagement, {
          userId,
          recordingHighlightId: highlightId,
          liked: false,
          saved: true,
        });
        await em.save(row);
      } else {
        row.saved = next;
        if (!row.liked && !row.saved) {
          await em.remove(row);
        } else {
          await em.save(row);
        }
      }
    });

    const row = await this.reloadEngagementRow(userId, highlightId);
    return { saved: row?.saved ?? false };
  }

  async viewerStateMap(
    userId: string | null | undefined,
    highlightIds: string[],
  ): Promise<Map<string, { liked: boolean; saved: boolean }>> {
    const map = new Map<string, { liked: boolean; saved: boolean }>();
    if (!userId?.trim?.() || highlightIds.length === 0) {
      return map;
    }

    const rows = await this.engagementRepo.find({
      where: { userId, recordingHighlightId: In(highlightIds) },
    });
    for (const r of rows) {
      map.set(r.recordingHighlightId, { liked: r.liked, saved: r.saved });
    }
    return map;
  }

  async listSavedSummaries(userId: string): Promise<SavedHighlightSummaryDto[]> {
    const rows = await this.engagementRepo.find({
      where: { userId, saved: true },
      relations: ['highlight'],
      order: { updatedAt: 'DESC' },
      take: 120,
    });

    const out: SavedHighlightSummaryDto[] = [];
    for (const r of rows) {
      const h = r.highlight;
      if (!h) continue;
      const st = String(h.status ?? '').toLowerCase();
      if (st === 'failed' || st === 'permanently_failed') {
        continue;
      }
      const url =
        h.mux_public_playback_url ??
        (h.playback_id
          ? `https://stream.mux.com/${h.playback_id}.m3u8`
          : null);
      if (!url) continue;
      out.push({
        recordingId: h.recordingId,
        highlightId: h.id,
        relativeTimestamp: h.relative_timestamp ?? null,
        muxPublicPlaybackUrl: url,
        thumbnailUrl: h.playback_id
          ? `https://image.mux.com/${h.playback_id}/thumbnail.jpg?time=2`
          : null,
        status: h.status ?? 'unknown',
      });
    }
    return out;
  }
}
