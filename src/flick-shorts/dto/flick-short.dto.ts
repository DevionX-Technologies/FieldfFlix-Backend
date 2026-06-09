import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFlickShortDto {
  @IsUUID()
  recordingId: string;

  @IsIn(['pickleball', 'padel', 'cricket'])
  sport: 'pickleball' | 'padel' | 'cricket';

  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @MaxLength(2000)
  topText: string;

  @IsString()
  @MaxLength(2000)
  bottomText: string;

  @IsIn(['9:16', '16:9'])
  aspect: '9:16' | '16:9';

  /** Seconds into the source recording (≥ 0). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(86400)
  startSec?: number;

  /**
   * End time in seconds (exclusive upper bound in player loop). If omitted, defaults to
   * `start + 15` (capped at 15s after `startSec`).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(86400)
  endSec?: number;
}

/**
 * Body for `POST /flick-shorts/from-highlight/:highlightId`. The recording id
 * and Mux playback id are derived from the highlight server-side; the user
 * only chooses the framing copy.
 */
export class SubmitHighlightAsFlickShortDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  topText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bottomText?: string;

  /**
   * Number of seconds of footage to keep BEFORE the highlight moment. The
   * total clip is capped at 15s by `FLICK_SHORT_MAX_SEC`; the rest is
   * footage after the moment.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(14)
  preRollSec?: number;
}

export class FlickShortCommentBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}

export class SetApprovedBodyDto {
  @IsOptional()
  @IsBoolean()
  approved?: boolean;
}
