/**
 * Type definitions for the retry failed highlights Lambda function
 */

export interface LambdaEvent {
  source?: string;
  'detail-type'?: string;
  detail?: any;
}

export interface RetryResult {
  success: boolean;
  processedCount: number;
  retriedCount: number;
  errorsCount: number;
  results: RetryResultItem[];
  errors: RetryError[];
}

export interface RetryResultItem {
  highlightId: string;
  recordingId: string;
  success: boolean;
  result: any;
}

export interface RetryError {
  highlightId?: string;
  recordingId?: string;
  error: string;
}

// VideoClipResult removed - now using the service method's return type
