export interface ClipProcessorMessage {
  recordingId: string;
  highlightId: string;
  processingOrder: number;
  enqueuedAt: string;
}

export interface ClipProcessorResult {
  success: boolean;
  highlightId: string;
  recordingId: string;
  message: string;
  action?: 'processed' | 'requeued' | 'skipped' | 'failed';
}
