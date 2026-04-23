export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function validateEnvironmentVariables(): void {
  const required = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_DATABASE',
    'MUX_TOKEN_ID',
    'MUX_TOKEN_SECRET',
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
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    return hours * 3600 + minutes * 60 + seconds;
  } else {
    throw new Error(`Invalid relative timestamp format: ${relativeTimestamp}`);
  }
}

/**
 * Calculate rate limit delay using exponential backoff
 * delay = max(retryAfterHeader, baseDelay * 2^rateLimitRetryCount), capped at maxDelay
 */
export function calculateRateLimitDelay(
  rateLimitRetryCount: number,
  retryAfterHeader: number | null,
  baseDelay: number,
  maxDelay: number,
): number {
  const exponentialDelay = baseDelay * Math.pow(2, rateLimitRetryCount);
  const calculatedDelay = retryAfterHeader
    ? Math.max(retryAfterHeader, exponentialDelay)
    : exponentialDelay;
  return Math.min(calculatedDelay, maxDelay);
}

/**
 * Classify an HTTP error for retry strategy
 */
export function classifyError(error: any): {
  type: 'rate_limit' | 'server_error' | 'network_error' | 'bad_input' | 'auth_error';
  httpStatus?: number;
  retryAfter?: number;
} {
  const status = error?.response?.status;

  if (status === 429) {
    const retryAfter = parseInt(
      error?.response?.headers?.['retry-after'] || '0',
      10,
    );
    return {
      type: 'rate_limit',
      httpStatus: 429,
      retryAfter: retryAfter > 0 ? retryAfter : null,
    };
  }

  if (status === 400) {
    return { type: 'bad_input', httpStatus: 400 };
  }

  if (status === 401 || status === 403) {
    return { type: 'auth_error', httpStatus: status };
  }

  if (status >= 500) {
    return { type: 'server_error', httpStatus: status };
  }

  // Network errors (ECONNRESET, ETIMEDOUT, etc.)
  if (
    error?.code === 'ECONNRESET' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ECONNREFUSED' ||
    !status
  ) {
    return { type: 'network_error' };
  }

  return { type: 'server_error', httpStatus: status };
}
