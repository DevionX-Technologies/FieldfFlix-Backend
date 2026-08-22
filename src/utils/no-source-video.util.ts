export type NoSourceVideoAction =
  | 'no_source_video_pi_uploading'
  | 'no_source_video_not_started'
  | 'no_source_video_upload_failed';

export interface NoSourceVideoContext {
  status?: string | null;
  s3Path?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Why Mux ingest found no S3 MP4 — Pi in flight, never started, or failed. */
export function classifyNoSourceVideoAction(
  ctx: NoSourceVideoContext,
): NoSourceVideoAction {
  const status = String(ctx.status ?? '').toLowerCase();
  const meta =
    ctx.metadata && typeof ctx.metadata === 'object' ? ctx.metadata : {};
  const failedReason =
    typeof meta.extract_failed_reason === 'string'
      ? meta.extract_failed_reason.trim()
      : '';

  if (['failed', 'cancelled', 'interrupted'].includes(status) || failedReason) {
    return 'no_source_video_upload_failed';
  }

  if (['extracting', 'uploading', 'in_progress'].includes(status)) {
    return 'no_source_video_pi_uploading';
  }

  if (['uploaded', 'processing'].includes(status)) {
    if (meta.expected_s3_key || meta.mux_upload_id) {
      return 'no_source_video_pi_uploading';
    }
  }

  if (['requested', 'pending'].includes(status)) {
    return 'no_source_video_not_started';
  }

  if (!meta.extract_session_key && !meta.expected_s3_key) {
    return 'no_source_video_not_started';
  }

  if (meta.expected_s3_key || meta.extract_session_key) {
    return 'no_source_video_pi_uploading';
  }

  return 'no_source_video_not_started';
}
