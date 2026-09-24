export class MediaProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly operation: string,
    public readonly isRetryable: boolean = false,
    public readonly statusCode?: number,
    public readonly originalError?: unknown,
  ) {
    super(`[${provider}:${operation}] ${message}`);
    this.name = 'MediaProviderError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MediaProviderTimeoutError extends MediaProviderError {
  constructor(provider: string, operation: string, originalError?: unknown) {
    super('Operation timed out', provider, operation, true, 408, originalError);
    this.name = 'MediaProviderTimeoutError';
  }
}

export class MediaProviderRateLimitError extends MediaProviderError {
  constructor(
    provider: string,
    operation: string,
    public readonly retryAfterSeconds?: number,
    originalError?: unknown,
  ) {
    super(
      `Rate limit exceeded${retryAfterSeconds ? `. Retry after ${retryAfterSeconds}s` : ''}`,
      provider,
      operation,
      true,
      429,
      originalError,
    );
    this.name = 'MediaProviderRateLimitError';
  }
}

export class MediaProviderAuthError extends MediaProviderError {
  constructor(provider: string, operation: string, originalError?: unknown) {
    super(
      'Authentication or authorization failed',
      provider,
      operation,
      false,
      401,
      originalError,
    );
    this.name = 'MediaProviderAuthError';
  }
}

export class MediaProviderNotFoundError extends MediaProviderError {
  constructor(
    provider: string,
    operation: string,
    resource: string,
    originalError?: unknown,
  ) {
    super(
      `Resource not found: ${resource}`,
      provider,
      operation,
      false,
      404,
      originalError,
    );
    this.name = 'MediaProviderNotFoundError';
  }
}

export function isRetryableMediaError(error: unknown): boolean {
  if (error instanceof MediaProviderError) {
    return error.isRetryable;
  }
  if (error && typeof error === 'object' && 'response' in error) {
    const status = (error as any).response?.status;
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
  }
  return false;
}
