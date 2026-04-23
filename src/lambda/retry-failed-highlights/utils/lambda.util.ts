/**
 * Utility functions for the retry failed highlights Lambda function
 */

/**
 * Utility function to create a delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Removed calculateBackoffDelay and isRetryableError - now using the service method's built-in retry logic

/**
 * Format Lambda response for CloudWatch logs
 */
export function formatLogMessage(message: string, data?: any): string {
  const timestamp = new Date().toISOString();
  const logData = data ? JSON.stringify(data) : '';
  return `[${timestamp}] ${message} ${logData}`;
}

/**
 * Validate required environment variables
 */
export function validateEnvironmentVariables(): void {
  const required = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_DATABASE',
    'CLIP_PROCESSING_QUEUE_URL',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

export function parseRelativeTimestampToSeconds(
  relativeTimestamp: string,
): number {
  const parts = relativeTimestamp.split(':');

  if (parts.length === 2) {
    // MM:SS format
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    return hours * 3600 + minutes * 60 + seconds;
  } else {
    throw new Error(`Invalid relative timestamp format: ${relativeTimestamp}`);
  }
}
