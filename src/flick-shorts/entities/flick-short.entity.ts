import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FlickShortComment = {
  id: string;
  userId: string;
  userName: string | null;
  text: string;
  createdAt: string;
};

@Entity('flick_shorts')
export class FlickShort {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recording_id', type: 'uuid' })
  recordingId: string;

  /** Client sport tab id: `pickleball` | `padel` | `cricket` */
  @Column({ type: 'varchar', length: 32 })
  sport: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({ name: 'top_text', type: 'text', default: '' })
  topText: string;

  @Column({ name: 'bottom_text', type: 'text', default: '' })
  bottomText: string;

  @Column({ type: 'varchar', length: 8 })
  aspect: '9:16' | '16:9';

  @Column({ name: 'mux_playback_id', type: 'varchar', length: 128 })
  muxPlaybackId: string;

  /** Inclusive HLS time window; `endSec - startSec` must be ≤ 15s (enforced in API + DB). */
  @Column({ name: 'start_sec', type: 'double precision', default: 0 })
  startSec: number;

  @Column({ name: 'end_sec', type: 'double precision', default: 15 })
  endSec: number;

  @Column({ type: 'boolean', default: false })
  approved: boolean;

  @Column({ name: 'likes_count', type: 'int', default: 0 })
  likesCount: number;

  @Column({ name: 'views_count', type: 'int', default: 0 })
  viewsCount: number;

  /** User ids that currently like this short (used for toggle + per-user state). */
  @Column({ name: 'liked_user_ids', type: 'jsonb', default: () => "'[]'" })
  likedUserIds: string[];

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  /**
   * The highlight this FlickShort was generated from (when submitted via the
   * mobile app's "Submit to FlickShorts" sheet). Used to dedupe: as long as
   * a row with the same `sourceHighlightId` exists, the highlight cannot be
   * resubmitted. Admin can "reject" by `DELETE`-ing the pending row, which
   * also frees the highlight for resubmission.
   *
   * `null` for rows created via the admin Studio (which doesn't pick a
   * highlight — it free-form-picks startSec/endSec from a recording).
   */
  @Column({ name: 'source_highlight_id', type: 'uuid', nullable: true })
  sourceHighlightId: string | null;

  @Column({ type: 'jsonb', default: () => '[]' })
  comments: FlickShortComment[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
