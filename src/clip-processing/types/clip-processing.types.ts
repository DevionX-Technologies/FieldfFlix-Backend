export type ClipProcessingSource =
  | 'webhook'
  | 'single_highlight'
  | 'bulk_highlight'
  | 'sweep'
  | 'legacy'
  | 'unknown';

export interface ClipProcessingMessage {
  recordingId: string;
  source: ClipProcessingSource;
  enqueuedAt: string;
}

export interface HighlightProcessingResult {
  highlightId: string;
  success: boolean;
  action: 'processed' | 'skipped' | 'failed' | 'permanently_failed';
  message: string;
}

export interface RecordingProcessingResult {
  recordingId: string;
  status: 'completed' | 'partial' | 'failed' | 'locked' | 'no_highlights';
  processed: number;
  failed: number;
  skipped: number;
  permanentlyFailed: number;
  results: HighlightProcessingResult[];
  durationMs: number;
}

export interface ErrorClassification {
  type:
    | 'rate_limit'
    | 'server_error'
    | 'network_error'
    | 'bad_input'
    | 'auth_error';
  httpStatus?: number;
  retryAfter?: number;
}
