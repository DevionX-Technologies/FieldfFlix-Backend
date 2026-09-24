export type LiveSessionState =
  | 'CREATED'
  | 'PROVISIONING'
  | 'READY'
  | 'CONNECTING'
  | 'LIVE'
  | 'RECONNECTING'
  | 'STOPPING'
  | 'ENDED'
  | 'FAILED';

export type MediaAssetState =
  | 'CREATED'
  | 'UPLOAD_PENDING'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'READY'
  | 'PUBLISHED'
  | 'ARCHIVED'
  | 'FAILED'
  | 'DELETED';

export class MediaStateTransitionError extends Error {
  constructor(
    public readonly entityType: 'live_session' | 'media_asset',
    public readonly currentState: string,
    public readonly targetState: string,
    public readonly reason: string,
  ) {
    super(
      `Invalid ${entityType} transition from '${currentState}' to '${targetState}': ${reason}`,
    );
    this.name = 'MediaStateTransitionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LiveSessionStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<
    LiveSessionState,
    LiveSessionState[]
  > = {
    CREATED: ['PROVISIONING', 'FAILED'],
    PROVISIONING: ['READY', 'FAILED'],
    READY: ['CONNECTING', 'LIVE', 'STOPPING', 'FAILED'],
    CONNECTING: ['LIVE', 'RECONNECTING', 'STOPPING', 'FAILED'],
    LIVE: ['RECONNECTING', 'STOPPING', 'ENDED'],
    RECONNECTING: ['LIVE', 'STOPPING', 'ENDED', 'FAILED'],
    STOPPING: ['ENDED', 'FAILED'],
    ENDED: [],
    FAILED: [],
  };

  static canTransition(from: LiveSessionState, to: LiveSessionState): boolean {
    if (from === to) return true; // Idempotent same-state update
    const allowed = this.ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  static assertValidTransition(
    from: LiveSessionState,
    to: LiveSessionState,
  ): void {
    if (!this.canTransition(from, to)) {
      throw new MediaStateTransitionError(
        'live_session',
        from,
        to,
        `Transition is not permitted by state machine rules.`,
      );
    }
  }

  static isTerminal(state: LiveSessionState): boolean {
    return state === 'ENDED' || state === 'FAILED';
  }

  /**
   * Out-of-order event guard. If the stream has already progressed to LIVE,
   * STOPPING, or ENDED, an older event like READY or CONNECTING must be ignored.
   */
  static shouldIgnoreOutOfOrder(
    current: LiveSessionState,
    incoming: LiveSessionState,
  ): boolean {
    const progressionOrder: LiveSessionState[] = [
      'CREATED',
      'PROVISIONING',
      'READY',
      'CONNECTING',
      'LIVE',
      'STOPPING',
      'ENDED',
    ];

    const currentIndex = progressionOrder.indexOf(current);
    const incomingIndex = progressionOrder.indexOf(incoming);

    if (currentIndex !== -1 && incomingIndex !== -1) {
      return incomingIndex < currentIndex;
    }

    if (this.isTerminal(current)) {
      return true;
    }

    return false;
  }
}

export class MediaAssetStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<
    MediaAssetState,
    MediaAssetState[]
  > = {
    CREATED: ['UPLOAD_PENDING', 'UPLOADING', 'FAILED'],
    UPLOAD_PENDING: ['UPLOADING', 'UPLOADED', 'FAILED'],
    UPLOADING: ['UPLOADED', 'FAILED'],
    UPLOADED: ['PROCESSING', 'FAILED'],
    PROCESSING: ['READY', 'FAILED'],
    READY: ['PUBLISHED', 'ARCHIVED', 'DELETED'],
    PUBLISHED: ['ARCHIVED', 'DELETED'],
    ARCHIVED: ['DELETED'],
    FAILED: ['UPLOAD_PENDING', 'PROCESSING'], // Retries permitted
    DELETED: [],
  };

  static canTransition(from: MediaAssetState, to: MediaAssetState): boolean {
    if (from === to) return true; // Idempotent same-state update
    const allowed = this.ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  static assertValidTransition(
    from: MediaAssetState,
    to: MediaAssetState,
  ): void {
    if (!this.canTransition(from, to)) {
      throw new MediaStateTransitionError(
        'media_asset',
        from,
        to,
        `Transition is not permitted by state machine rules.`,
      );
    }
  }

  static isPlayable(state: MediaAssetState): boolean {
    return state === 'READY' || state === 'PUBLISHED';
  }

  static isTerminal(state: MediaAssetState): boolean {
    return state === 'DELETED';
  }

  /**
   * Out-of-order event guard. If the video is already READY or PUBLISHED,
   * an out-of-order late PROCESSING or UPLOADING webhook must be ignored.
   */
  static shouldIgnoreOutOfOrder(
    current: MediaAssetState,
    incoming: MediaAssetState,
  ): boolean {
    if (
      this.isPlayable(current) &&
      (incoming === 'PROCESSING' || incoming === 'UPLOADING')
    ) {
      return true;
    }
    if (current === 'DELETED') {
      return true;
    }
    return false;
  }
}
