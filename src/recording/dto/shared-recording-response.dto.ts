import { ApiProperty } from '@nestjs/swagger';

/**
 * Interface for turf detail information in shared recording response.
 */
export interface TurfDetailDto {
  id: string;
  name: string;
  geo_location: object | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  location: string | null;
  country: string | null;
}

/**
 * Interface for recording highlight information in shared recording response.
 */
export interface RecordingHighlightDto {
  id: string;
  button_click_timestamp: Date;
  relative_timestamp: string | null;
  asset_id: string | null;
  status: string | null;
  playback_id: string | null;
  mux_public_playback_url: string | null;
}

/**
 * Interface for recording information in shared recording response.
 */
export interface RecordingDetailDto {
  id: string;
  userId: string;
  owner_name: string;
  turfId: string | null;
  turf_detail: TurfDetailDto | null;
  startTime: Date;
  endTime: Date | null;
  s3Path: string | null;
  status: string;
  mux_asset_id: string | null;
  mux_playback_id: string | null;
  mux_media_url: string | null;
  recordingHighlights: RecordingHighlightDto[];
}

/**
 * Type alias for SharedRecordingResponseDto array (for return types).
 */
export type SharedRecordingResponseArray = SharedRecordingResponseDto[];

/**
 * Class for shared recording response (for Swagger documentation).
 */
export class SharedRecordingResponseDto {
  @ApiProperty({
    description: 'Shared recording ID',
    example: '54ef22e0-6438-4b22-9ef1-e1a63366a193',
  })
  id: string;

  @ApiProperty({
    description: 'ID of the user with whom the recording is shared',
    example: 'f9bbd25b-5ce4-4475-b584-6462900376a1',
  })
  shared_with_user_id: string;

  @ApiProperty({
    description: 'Name of the user with whom the recording is shared',
    example: 'John Doe',
  })
  shared_with_user_name: string;

  @ApiProperty({
    description: 'Recording details',
    type: 'object',
  })
  recording: RecordingDetailDto;
}
