export interface RecordingKeyOptions {
  recordingId: string;
  environment?: string;
  timestamp?: string | number;
  format?: 'structured' | 'legacy';
  extension?: string;
}

export interface TournamentKeyOptions {
  tournamentId: string;
  recordingId: string;
  courtId?: string;
  environment?: string;
  extension?: string;
}

export interface HighlightKeyOptions {
  highlightId: string;
  environment?: string;
  extension?: string;
}

export class R2ObjectKeyBuilder {
  private static defaultEnvironment(): string {
    return process.env.ENVIRONMENT || 'production';
  }

  /**
   * Generates a match recording object key.
   * If format === 'legacy', returns `recordings/{recordingId}_{timestamp}.mp4`
   * Otherwise returns `{env}/recordings/{recordingId}/{timestamp}_original.mp4`
   */
  static buildRecordingKey(options: RecordingKeyOptions): string {
    const ext = (options.extension || 'mp4').replace(/^\./, '');
    const ts = options.timestamp
      ? String(options.timestamp)
      : Date.now().toString();

    if (options.format === 'legacy') {
      return `recordings/${options.recordingId}_${ts}.${ext}`;
    }

    const env = options.environment || this.defaultEnvironment();
    return `${env}/recordings/${options.recordingId}/${ts}_original.${ext}`;
  }

  /**
   * Generates a tournament-scoped court recording object key.
   * E.g. `{env}/tournaments/{tournamentId}/courts/{courtId}/recordings/{recordingId}/original.mp4`
   */
  static buildTournamentRecordingKey(options: TournamentKeyOptions): string {
    const env = options.environment || this.defaultEnvironment();
    const ext = (options.extension || 'mp4').replace(/^\./, '');
    const courtPart = options.courtId ? `courts/${options.courtId}/` : '';
    return `${env}/tournaments/${options.tournamentId}/${courtPart}recordings/${options.recordingId}/original.${ext}`;
  }

  /**
   * Generates a highlight clip object key.
   * E.g. `{env}/highlights/{highlightId}/clip.mp4`
   */
  static buildHighlightKey(options: HighlightKeyOptions): string {
    const env = options.environment || this.defaultEnvironment();
    const ext = (options.extension || 'mp4').replace(/^\./, '');
    return `${env}/highlights/${options.highlightId}/clip.${ext}`;
  }

  /**
   * Generates an HLS master manifest key for an asset.
   * E.g. `{env}/recordings/{recordingId}/hls/master.m3u8`
   */
  static buildHlsMasterManifestKey(options: {
    recordingId: string;
    environment?: string;
  }): string {
    const env = options.environment || this.defaultEnvironment();
    return `${env}/recordings/${options.recordingId}/hls/master.m3u8`;
  }

  /**
   * Generates a thumbnail or poster object key.
   * E.g. `{env}/thumbnails/{recordingId}/poster.jpg`
   */
  static buildThumbnailKey(options: {
    recordingId: string;
    environment?: string;
    filename?: string;
  }): string {
    const env = options.environment || this.defaultEnvironment();
    const filename = options.filename || 'poster.jpg';
    return `${env}/thumbnails/${options.recordingId}/${filename}`;
  }

  /**
   * Parses an object key to extract recordingId and detect format.
   */
  static parseRecordingKey(
    key: string,
  ): { recordingId: string; isLegacy: boolean } | null {
    if (!key) return null;

    // Legacy: recordings/{uuid}_{timestamp}.mp4
    const legacyMatch =
      /^recordings\/([0-9a-fA-F-]+)_[0-9]+(?:\.[a-zA-Z0-9]+)?$/.exec(key);
    if (legacyMatch) {
      return { recordingId: legacyMatch[1], isLegacy: true };
    }

    // Structured: {env}/recordings/{uuid}/...
    const structuredMatch = /^[^/]+\/recordings\/([0-9a-fA-F-]+)\/.*$/.exec(
      key,
    );
    if (structuredMatch) {
      return { recordingId: structuredMatch[1], isLegacy: false };
    }

    // Tournament structured: {env}/tournaments/{id}/.../recordings/{uuid}/...
    const tournMatch =
      /^[^/]+\/tournaments\/[^/]+(?:\/courts\/[^/]+)?\/recordings\/([0-9a-fA-F-]+)\/.*$/.exec(
        key,
      );
    if (tournMatch) {
      return { recordingId: tournMatch[1], isLegacy: false };
    }

    return null;
  }
}
