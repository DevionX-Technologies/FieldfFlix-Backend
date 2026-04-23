## Direct-to-Mux Recording & Highlights Migration

### Goals

- Remove S3 from the video recording pipeline for user sessions and Raspberry Pi ingest.
- When recording starts, stream/upload directly to Mux; when stopped, Mux finalizes and produces a ready VOD asset.
- Keep and improve highlight creation using Mux clipping against the finalized VOD.
- Preserve Swagger docs, DTO validation, structured logging, metrics, tracing, and security best practices.

### Out of Scope

- S3 usage for images/documents and other non-recording media stays as-is.

---

## Current Flow (Summary)

- Device records locally → uploads file to S3.
- Backend generates a pre-signed S3 URL and then creates a Mux asset from that S3 file.
- Recording status is updated when Mux asset is created/ready.

Key code paths:

- `src/recording/service/recording.service.ts` → `triggerMuxUpload(recordingId, s3Path)`
- `src/mux/mux.service.ts` → `uploadFromS3(s3Url, key, recordingId)`
- `src/file-service/file-service.service.ts` → S3 presign/get stream helpers
- Highlights already use Mux clipping (good):
  - `src/recording/service/recording-highlight.service.ts` → `createMuxClip(muxAssetId, startTime, endTime)`

Limitations:

- Double hop (device → S3 → Mux) increases latency/cost and operational complexity.
- Highlights depend on VOD being available and require waiting for S3 → Mux ingestion.

---

## New Architecture (No S3 for Recording)

### Primary Path: Mux Live Stream (RTMP) from Raspberry Pi

1. Backend creates a Mux Live Stream when the user starts recording.
   - Persist: `mux_live_stream_id`, `mux_stream_key`, `mux_ingest_url`, preview `mux_playback_id`.
2. Raspberry Pi pushes RTMP to `ingest_url/stream_key` using ffmpeg while recording.
3. On stop, the Pi stops pushing; Mux finalizes and creates a VOD asset automatically.
4. Mux webhooks drive state transitions and persist `mux_asset_id`, `mux_playback_id`, `mux_media_url`.

Benefits:

- No S3 hop, lower latency, fewer moving parts.
- Live preview possible via Mux playback during recording.

### Optional Fallback: Mux Direct Upload (tus)

If a device cannot stream RTMP reliably, the backend can create a short‑lived Mux upload URL; the device uploads directly to Mux; Mux creates the asset. Still no S3.

### Highlights

- “Highlight markers” are accepted during live recording and stored with offset since `startedAt`.
- When `video.asset.ready` webhook arrives, create Mux clips for each marker using the finalized VOD asset.
- Existing `createMuxClip` logic can be reused.

---

## API Design (NestJS + Swagger)

### Start Recording

- POST `/v1/recordings/start`
- Body:

```json
{
  "cameraId": "<uuid>",
  "title": "optional title",
  "metadata": { "any": "structured" }
}
```

- Response:

```json
{
  "recordingId": "<uuid>",
  "ingestUrl": "rtmp://<mux-ingest-host>/app",
  "streamKey": "<mux-stream-key>",
  "playbackId": "<mux-preview-playback-id>",
  "hlsPreviewUrl": "https://stream.mux.com/<playbackId>.m3u8"
}
```

### Stop Recording

- POST `/v1/recordings/{id}/stop`
- Server marks status `stopping` and the device stops ffmpeg; Mux will finalize and send webhooks.

### Create Highlight Marker

- POST `/v1/recordings/{id}/highlights`
- Body:

```json
{
  "-": 172000,
  "preMs": 5000,
  "postMs": 5000,
  "label": "Goal"
}
```

- Stores marker immediately (idempotent). If VOD is ready, enqueue clip creation now.

### Recording Status

- GET `/v1/recordings/{id}/status`
- Returns DB status, known Mux IDs, and playback URLs if available.

### Mux Webhook

- POST `/v1/mux/webhook`
- Verify signature; handle events:
  - `video.live_stream.connected` → `status = live`
  - `video.live_stream.disconnected` → `status = processing`
  - `video.asset.created` → attach `mux_asset_id`
  - `video.asset.ready` → set `status = ready`; persist `mux_playback_id`, `mux_media_url`; trigger highlight jobs
  - `*.errored` → `status = failed`

All DTOs annotated with `class-validator` and `@nestjs/swagger` decorators.

---

## Data Model Changes

### Recording (add if missing)

- `mux_live_stream_id: string | null`
- `mux_stream_key: string | null`
- `mux_ingest_url: string | null`
- `mux_asset_id: string | null`
- `mux_playback_id: string | null`
- `mux_media_url: string | null`
- `status: 'starting' | 'live' | 'stopping' | 'processing' | 'ready' | 'failed'`
- `startedAt: Date`
- `endedAt: Date | null`

### RecordingHighlight

- `recordingId: UUID`
- `offsetMs: number`
- `windowPreMs: number`
- `windowPostMs: number`
- `label?: string`
- `clipAssetId?: string`
- `status: 'queued' | 'processing' | 'ready' | 'failed'`

---

## Service Changes

### MuxService (extend/replace S3 workflows)

- `createLiveStream(options)` → returns `{ liveStreamId, streamKey, ingestUrl, playbackId }`
- `getLiveStream(liveStreamId)`
- `disableLiveStream(liveStreamId)` (optional lifecycle)
- `createDirectUpload(corsOrigin)` (fallback)
- `createClip(muxAssetId, startSec, endSec)` → reuse existing clipping pattern
- `handleWebhook(rawBody, signature)` → verify and emit domain events

### RecordingService

- `startRecording(cameraId)` calls `MuxService.createLiveStream`, creates `Recording`, returns ingest details.
- `stopRecording(id)` marks status `stopping`; device stops push; wait for webhook transitions.
- React to Mux events to persist IDs and state.

### RecordingHighlightsService

- `markHighlight(recordingId, offsetMs, windowPreMs, windowPostMs, label)` stores marker.
- On `asset.ready`, create clips for all queued markers.

---

## Webhooks & State Machine

- `video.live_stream.connected` → `starting → live`
- `video.live_stream.disconnected` → `live → processing`
- `video.asset.created` → persist `mux_asset_id`
- `video.asset.ready` → `processing → ready`; persist `mux_playback_id`, `mux_media_url`; trigger highlights
- `*.errored` → `failed`

Ensure idempotency (store `mux_event_id`), signature verification, retries on transient failures.

---

## Raspberry Pi (ffmpeg) Notes

Use provided ingest URL and stream key:

```bash
ffmpeg -f v4l2 -framerate 30 -video_size 1280x720 -i /dev/video0 \
  -f alsa -i hw:1 \
  -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -ar 44100 -b:a 128k \
  -f flv "rtmp://<ingest_host>/app/<stream_key>"
```

On stop, terminate ffmpeg gracefully; Mux finalizes to VOD and emits webhooks.

---

## Security, Logging, Observability

- Verify Mux signatures and optionally IP-allowlist webhook source.
- Structured JSON logging (requestId, userId, recordingId).
- Propagate `X-Request-ID` across requests and webhooks.
- Metrics: request latency, webhook handling duration, clip creation latency, error counters.
- Tracing: instrument Mux API calls and DB operations with OpenTelemetry.

---

## Testing

- Unit tests: `RecordingService.start/stop`, webhook transitions, `RecordingHighlightsService` window math and clipping.
- Integration tests: signed webhook simulations and end-to-end state changes.
- Enforce coverage ≥ 80% in CI.

---

## Migration Plan (Step-by-Step)

1. DB migration: add new `Recording` and `RecordingHighlight` fields as listed.
2. Implement `MuxService.createLiveStream`, `handleWebhook`, and `createClip` (if not already reusable).
3. Add controllers/endpoints: start, stop, status, create highlight, webhook.
4. Update `RecordingService` to use live streams (remove S3 references from recording path).
5. Update Raspberry Pi client to push RTMP to Mux using returned `ingestUrl` and `streamKey`.
6. Process highlights on `asset.ready` via queued jobs.
7. Backfill any UI to show live status and playback.
8. Run integration tests with fake webhooks; validate state machine.
9. Deprecate S3 video upload endpoints; keep S3 for images/files only.
10. Remove S3→Mux code in the recording pipeline once traffic is fully cut over.

---

## Deprecations / Removals (Recording Pipeline Only)

- `RecordingService.triggerMuxUpload` (S3 presign path)
- `MuxService.uploadFromS3`
- Any controllers/DTOs used solely for S3→Mux recording flow
- Calls to `FileServiceService.getSignedUrlFromS3` for recording videos (keep for images/profile media)

---

## Acceptance Criteria

- Start → live RTMP push working; Stop → Mux VOD asset created and playable.
- DB reflects correct Mux IDs and status transitions driven by webhooks.
- Highlight markers generate clip assets with public playback URLs.
- No S3 dependency for recording path.
- Swagger shows all new endpoints with validated DTOs.
- Tests pass with ≥ 80% coverage; observability in place.

---

## References

- Mux Live Streaming: [https://docs.mux.com/guides/video/live-streaming](https://docs.mux.com/guides/video/live-streaming)
- Mux Direct Upload (tus): [https://docs.mux.com/guides/video/upload-files](https://docs.mux.com/guides/video/upload-files)
- Mux Webhooks: [https://docs.mux.com/guides/video/receive-webhooks](https://docs.mux.com/guides/video/receive-webhooks)
