import { ClipProcessingEnqueueService } from './clip-processing.enqueue.service';
import { ClipProcessingProcessor } from './clip-processing.processor';

describe('ClipProcessingEnqueueService', () => {
  let service: ClipProcessingEnqueueService;
  let mockProcessor: Partial<ClipProcessingProcessor>;

  beforeEach(() => {
    delete process.env.CLIP_PROCESSING_QUEUE_URL;
    mockProcessor = {
      processRecording: jest.fn().mockResolvedValue({
        recordingId: 'rec-123',
        status: 'completed',
        processed: 2,
        failed: 0,
        skipped: 0,
        permanentlyFailed: 0,
        results: [],
        durationMs: 100,
      } as any),
    };
  });

  it('should fall back to in-process clip processing when queue URL is unset', async () => {
    service = new ClipProcessingEnqueueService(mockProcessor as ClipProcessingProcessor);

    const result = await service.enqueueRecording('rec-123', 'webhook');
    expect(result).toBe('in-process');

    // Wait for setImmediate to execute
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockProcessor.processRecording).toHaveBeenCalledWith('rec-123');
  });

  it('should return undefined if queue URL is unset and no processor is provided', async () => {
    service = new ClipProcessingEnqueueService(undefined);

    const result = await service.enqueueRecording('rec-123', 'webhook');
    expect(result).toBeUndefined();
  });
});
