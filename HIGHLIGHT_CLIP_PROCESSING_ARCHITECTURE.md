# FieldFlicks: Recording & Highlight Clip Processing Architecture

> Complete system design for sequential highlight clip creation, Mux error handling, rate limit management, and retry strategy.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [End-to-End Flow (Step by Step)](#2-end-to-end-flow)
3. [How Highlights Are Stored in Sequence](#3-how-highlights-are-stored-in-sequence)
4. [How Sequential Processing Works](#4-how-sequential-processing-works)
5. [Multiple Concurrent Recordings](#5-multiple-concurrent-recordings)
6. [Highlight Status Lifecycle](#6-highlight-status-lifecycle)
7. [Error Handling: Rate Limits vs Other Errors](#7-error-handling)
8. [Retry Strategy & Failure Handling](#8-retry-strategy)
9. [Webhook Optimization: Check Highlight First](#9-webhook-optimization-check-highlight-first)
10. [Webhook Idempotency](#10-webhook-idempotency)
11. [Sweep Lambda (retryFailedHighlights)](#11-sweep-lambda)
12. [Database Schema](#12-database-schema)
13. [Infrastructure (SQS + Lambda)](#13-infrastructure)
14. [Edge Cases](#14-edge-cases)
15. [File Reference](#15-file-reference)

---

## 1. System Overview

### Architecture Diagram

```
USER DURING RECORDING                         AFTER RECORDING STOPS
========================                      =====================

  User taps highlight                         Recording uploaded to S3
        |                                              |
        v                                              v
  POST /recording/:id/highlight               muxUploadVideo Lambda
        |                                     (S3 trigger)
        v                                              |
  DB: RecordingHighlights                     Creates Mux asset from S3
  status = 'pending'                                   |
  processing_order = N                        Mux processes video...
                                                       |
                                              Mux sends webhook:
                                              "video.asset.ready"
                                                       |
                                                       v
                                            +---------------------+
                                            | Webhook Handler     |
                                            | (NestJS Controller) |
                                            +----------+----------+
                                                       |
                                            1. Idempotency check
                                            2. Find all pending highlights
                                            3. Set status = 'queued'
                                            4. Enqueue FIRST to SQS
                                                       |
                                                       v
                                            +---------------------+
                                            |  SQS Queue          |
                                            |  (clip-processing)  |
                                            +----------+----------+
                                                       |
                                            +----------v----------+
                                            |  clipProcessor       |
                                            |  Lambda              |
                                            |  batchSize=1         |
                                            |  maxConcurrency=2    |
                                            +----------+----------+
                                                       |
                                         +-------------+-------------+
                                         |             |             |
                                    201 Success   429 Rate Limit   5xx Error
                                         |             |             |
                                   clip_created   rate_limited     failed
                                   Enqueue NEXT   Re-enqueue      Re-enqueue
                                   (5s delay)     (calculated     (backoff
                                         |        delay)           delay)
                                         v
                                   Mux processes clip...
                                   Webhook: "video.asset.ready" (for clip)
                                         |
                                         v
                                   status = 'ready'
                                   (playback URL available)


                                            +---------------------+
                                            | Sweep Lambda        |
                                            | (every 10 minutes)  |
                                            |                     |
                                            | Catches:            |
                                            | - stuck processing  |
                                            | - missed pending    |
                                            | - stuck rate_limited|
                                            | - failed + retries  |
                                            | - stuck queued      |
                                            +---------------------+
```

### Key Components

| Component | Type | Purpose |
|-----------|------|---------|
| **Webhook Handler** | NestJS Controller + Service | Receives Mux webhooks, deduplicates, enqueues first highlight to SQS |
| **SQS Queue** (`clip-processing`) | AWS SQS Standard Queue | Decouples clip creation from webhook; provides rate limiting via concurrency |
| **SQS DLQ** (`clip-processing-dlq`) | AWS SQS Dead Letter Queue | Captures messages that fail after 5 SQS-level delivery attempts |
| **clipProcessor Lambda** | AWS Lambda (SQS trigger) | Processes one clip at a time with advisory locks, sequential ordering, error classification |
| **retryFailedHighlights Lambda** | AWS Lambda (EventBridge, every 10 min) | Sweeps stuck/failed/missed highlights and re-enqueues them to SQS |
| **webhook_events table** | PostgreSQL | Deduplication of Mux webhook events |

---

## 2. End-to-End Flow

### Phase 1: Recording & Highlight Creation

```
Step 1: User starts recording
        -> POST /recording/start
        -> Recording entity created: status='in_progress', startTime=now()

Step 2: User taps highlight button (can happen multiple times during recording)
        -> Raspberry Pi calls POST /recording/:raspberryPiRecordingId/highlight
        -> Code in: recording-highlight.service.ts → createRecordingHighlight()

        What happens:
        a) Validates recording exists and has a startTime
        b) Calculates relative_timestamp (how far into the video)
        c) Validates 30-second gap between highlights
        d) Computes processing_order = MAX(processing_order) + 1 for this recording
        e) Creates RecordingHighlights entity:
           - status = 'pending'
           - processing_order = N (1, 2, 3, ...)
           - button_click_timestamp = server time (not Pi time)
           - relative_timestamp = "3:02" or "1:05:30"
        f) If recording already has mux_asset_id (late highlight):
           - Immediately sets status = 'queued'
           - Enqueues to SQS

Step 3: User stops recording
        -> PUT /recording/stop/:id
        -> Recording status -> 'processing'
        -> Pi uploads MP4 to S3
        -> Recording status -> 'completed', s3Path set
```

### Phase 2: Mux Asset Creation

```
Step 4: S3 ObjectCreated event triggers muxUploadVideo Lambda
        -> Finds recording by raspberryPiRecordingId
        -> Creates Mux asset from S3 URL (POST /video/v1/assets)
        -> Stores mux_asset_id on recording
        -> Recording: isVideoCreated = true

Step 5: Mux processes the full video... (takes seconds to minutes)
```

### Phase 3: Webhook -> SQS Enqueue

```
Step 6: Mux sends "video.asset.ready" webhook for the SOURCE recording
        -> POST /webhooks/mux

Step 7: Webhook handler (handleMuxWebhook in recording-highlight.service.ts):
        a) Compute idempotency key: "video.asset.ready:<assetId>:ready"
        b) INSERT INTO webhook_events ... ON CONFLICT DO NOTHING RETURNING id
        c) If duplicate -> return 200 immediately (already processed)
        d) Find recording by mux_asset_id
        e) Update recording status = 'ready'
        f) Find all highlights WHERE recording_id = X AND isClipCreated = false
           ORDER BY processing_order ASC
        g) For EACH highlight:
           - Set status = 'queued'
           - Set source_asset_id = recording.mux_asset_id
        h) Commit transaction
        i) AFTER commit: Enqueue only the FIRST highlight to SQS
           (subsequent ones are triggered by clipProcessor after each success)
        j) Return 200 to Mux (fast response — all work is deferred)
```

### Phase 4: Clip Processing (clipProcessor Lambda)

```
Step 8: SQS delivers message to clipProcessor Lambda
        Message: { recordingId, highlightId, processingOrder, enqueuedAt }

Step 9: clipProcessor (clip-processor.service.ts → processMessage):

        a) SEQUENTIAL CHECK:
           "Are there highlights with processing_order < mine that are NOT done?"
           Done = clip_created, ready, or permanently_failed

           If YES -> re-queue with 30s delay (not my turn yet)

        b) ADVISORY LOCK:
           SELECT pg_try_advisory_lock(hashtext(recordingId))

           If NOT acquired -> re-queue with 15s delay
           (another Lambda is processing this recording right now)

        c) FETCH HIGHLIGHT:
           Get full highlight + recording data

           If status is already terminal (clip_created/ready/permanently_failed):
           -> skip (idempotent)

        d) OPTIMISTIC LOCK:
           UPDATE SET status='processing', lock_version=lock_version+1
           WHERE id=$1 AND lock_version=$expected

           If 0 rows updated -> skip (concurrent modification)

        e) CALL MUX API:
           POST https://api.mux.com/video/v1/assets
           {
             input: [{ url: "mux://assets/<sourceAssetId>", start_time, end_time }],
             playback_policy: ['public'],
             video_quality: 'basic'
           }

        f) HANDLE RESPONSE: (see Section 6 for error handling details)

           201 Success:
           -> status = 'clip_created'
           -> asset_id = mux response id
           -> isClipCreated = true
           -> retryCount = 0 (reset)
           -> Enqueue NEXT highlight (processing_order + 1) with 5s delay

           429 Rate Limit:
           -> status = 'rate_limited'
           -> rate_limit_retry_count++
           -> Re-enqueue with calculated delay
           -> Do NOT increment retryCount

           400 Bad Input:
           -> status = 'permanently_failed'
           -> No retry (input will never become valid)

           401/403 Auth Error:
           -> status = 'permanently_failed'
           -> Log alert about Mux credentials

           500/502/503 Server Error:
           -> status = 'failed'
           -> retryCount++
           -> Re-enqueue with exponential backoff

           Network Error (ECONNRESET/ETIMEDOUT):
           -> Same as server error

        g) RELEASE ADVISORY LOCK

        h) SQS message auto-deleted on Lambda success
```

### Phase 5: Clip Becomes Ready

```
Step 10: Mux processes the clip and sends "video.asset.ready" webhook
         -> Same webhook endpoint
         -> Idempotency check (webhook_events)
         -> This time, no recording found for asset_id
         -> Find RecordingHighlight by asset_id
         -> Update: status = 'ready', playback_id, mux_public_playback_url
         -> User can now watch the highlight clip
```

---

## 3. How Highlights Are Stored in Sequence

### The `processing_order` Column

Every highlight gets a **monotonically increasing integer** within its recording:

```
Recording A:
  Highlight 1  ->  processing_order = 1  (button pressed at 1:30)
  Highlight 2  ->  processing_order = 2  (button pressed at 3:45)
  Highlight 3  ->  processing_order = 3  (button pressed at 7:12)

Recording B:
  Highlight 1  ->  processing_order = 1  (button pressed at 0:45)
  Highlight 2  ->  processing_order = 2  (button pressed at 2:10)
```

### How It's Assigned

When a highlight is created (`createRecordingHighlight()`):

```sql
-- Get the next order number for this recording
SELECT COALESCE(MAX(processing_order), 0) AS max_order
FROM recording_highlights
WHERE recording_id = $1;

-- New highlight gets max_order + 1
processing_order = max_order + 1;
```

This runs inside a **transaction** (`queryRunner.startTransaction()`), so two concurrent highlight creations for the same recording won't get the same number.

### For Existing Data (Migration Backfill)

The migration `AddClipProcessingColumns1760000000001` backfills existing highlights:

```sql
UPDATE recording_highlights rh
SET processing_order = sub.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY recording_id
    ORDER BY button_click_timestamp ASC
  ) AS row_num
  FROM recording_highlights
) sub
WHERE rh.id = sub.id
```

This assigns `1, 2, 3, ...` to existing highlights based on their `button_click_timestamp` order.

### Why Not Just Use button_click_timestamp?

- Timestamps can have equal values (millisecond precision collisions)
- Integer comparison is faster than timestamp comparison in database queries
- An explicit order number makes the "is it my turn?" check simple and deterministic

---

## 4. How Sequential Processing Works

### The Three Locks

The clipProcessor uses **three layers** to guarantee sequence:

```
Layer 1: processing_order check
  "Are all highlights with order < mine finished?"
  If no -> re-queue (not my turn)

Layer 2: PostgreSQL advisory lock
  pg_try_advisory_lock(hashtext(recordingId))
  Only ONE Lambda can process a given recording at a time

Layer 3: Optimistic lock (lock_version)
  Prevents stale updates if two Lambdas race on the same highlight
```

### Sequential Algorithm (Visual)

```
Recording has 3 highlights: order=1, order=2, order=3

Time 0:  Webhook fires. All 3 set to 'queued'. Only order=1 enqueued to SQS.

Time 1:  clipProcessor receives order=1
         Check: any order < 1 not done? NO
         Acquire lock for recording: YES
         Process: call Mux API -> 201 success
         Update order=1 to 'clip_created'
         Enqueue order=2 with 5s delay
         Release lock

Time 6:  clipProcessor receives order=2 (after 5s SQS delay)
         Check: any order < 2 not done?
           order=1 is 'clip_created' -> DONE
         NO predecessors pending
         Acquire lock: YES
         Process: call Mux API -> 201 success
         Update order=2 to 'clip_created'
         Enqueue order=3 with 5s delay
         Release lock

Time 11: clipProcessor receives order=3
         Check: any order < 3 not done?
           order=1 is 'clip_created' -> DONE
           order=2 is 'clip_created' -> DONE
         NO predecessors pending
         Acquire lock: YES
         Process: call Mux API -> 201 success
         Update order=3 to 'clip_created'
         No more highlights to enqueue
         Release lock

Later:   Mux webhooks arrive for each clip -> status = 'ready'
```

### What "Done" Means for Predecessor Check

A highlight is considered "done" (won't block the next one) if its status is:
- `clip_created` — Mux accepted it, clip is encoding
- `ready` — clip is fully ready
- `permanently_failed` — gave up on it, move on

All other statuses (`pending`, `queued`, `processing`, `failed`, `rate_limited`) mean "not done yet" and will block later highlights.

### Cross-Recording Concurrency

Different recordings process **independently** and **in parallel**:

```
Recording A: highlight 1 -> highlight 2 -> highlight 3  (sequential)
Recording B: highlight 1 -> highlight 2                  (sequential)

But Recording A and Recording B can process AT THE SAME TIME
because the advisory lock is per-recording: hashtext(recordingIdA) != hashtext(recordingIdB)
```

The global limit is `maximumConcurrency: 2` on the SQS event source mapping, meaning at most 2 Lambda invocations run simultaneously. This keeps Mux API calls to 2 at a time maximum.

---

## 5. Multiple Concurrent Recordings

### The Scenario

Multiple users are recording at the same time, each creating highlights. All recordings stop around the same time, so the SQS queue receives highlights from **different recordings mixed together**.

```
User A: Recording with 3 highlights (A-1, A-2, A-3)
User B: Recording with 2 highlights (B-1, B-2)
User C: Recording with 4 highlights (C-1, C-2, C-3, C-4)

All three stop recording around the same time.
All three get Mux "video.asset.ready" webhooks close together.
```

### What the SQS Queue Looks Like

Messages from different recordings arrive mixed together:

```
SQS Queue (order of arrival):
  Message 1: { recordingId: A, highlightId: A-1, processingOrder: 1 }
  Message 2: { recordingId: B, highlightId: B-1, processingOrder: 1 }
  Message 3: { recordingId: C, highlightId: C-1, processingOrder: 1 }
```

**This is completely fine.** The system handles it correctly because of two key design decisions:

### Advisory Lock is PER RECORDING (Not Global)

```
Recording A gets lock: pg_try_advisory_lock(hashtext("recording-A-uuid"))
Recording B gets lock: pg_try_advisory_lock(hashtext("recording-B-uuid"))
Recording C gets lock: pg_try_advisory_lock(hashtext("recording-C-uuid"))

These are THREE DIFFERENT locks.
Recording A's lock does NOT block Recording B or C.
They can all process in parallel.
```

### Sequential Check is Also PER RECORDING

```
When processing highlight B-1:
  Query: "Are there highlights for RECORDING B with order < 1 that are not done?"

It does NOT look at Recording A or Recording C.
Each recording has its own independent sequence chain.
```

### Visual Timeline: 3 Recordings Processing Together

```
maximumConcurrency = 2 (only 2 Lambda instances run at once)

Time 0s:   Lambda-1 picks up A-1       Lambda-2 picks up B-1
           Lock recording A ✅          Lock recording B ✅
           Call Mux API                 Call Mux API

Time 1s:   A-1 -> clip_created ✅       B-1 -> clip_created ✅
           Enqueue A-2 (5s delay)       Enqueue B-2 (5s delay)
           Release lock A               Release lock B

Time 2s:   Lambda-1 picks up C-1       (A-2 and B-2 still delayed in SQS)
           Lock recording C ✅
           Call Mux API

Time 3s:   C-1 -> clip_created ✅
           Enqueue C-2 (5s delay)
           Release lock C

Time 6s:   Lambda-1 picks up A-2       Lambda-2 picks up B-2
           Check: A-1 done? YES ✅      Check: B-1 done? YES ✅
           Lock recording A ✅          Lock recording B ✅
           Call Mux API                 Call Mux API

Time 7s:   A-2 -> clip_created ✅       B-2 -> clip_created ✅
           Enqueue A-3 (5s delay)       No more B highlights
           Release lock A               Release lock B

Time 8s:   Lambda-2 picks up C-2
           Check: C-1 done? YES ✅
           Lock recording C ✅
           Call Mux API

Time 9s:   C-2 -> clip_created ✅
           Enqueue C-3 (5s delay)
           Release lock C

Time 12s:  Lambda-1 picks up A-3       Lambda-2 picks up C-3
           Check: A-1, A-2 done? YES ✅ Check: C-1, C-2 done? YES ✅
           Process...                   Process...
           ...and so on until all done
```

### What If There Are More Recordings Than Lambda Slots?

```
maximumConcurrency = 2, but 5 recordings need processing at once.

Queue has: A-1, B-1, C-1, D-1, E-1

Lambda-1 processes A-1    (slot 1 of 2 used)
Lambda-2 processes B-1    (slot 2 of 2 used)
C-1, D-1, E-1 stay in queue waiting (no available Lambda slot)

When Lambda-1 finishes A-1 -> slot freed
Lambda-1 now processes C-1

When Lambda-2 finishes B-1 -> slot freed
Lambda-2 now processes D-1

...and so on. All recordings eventually get processed.
More recordings = slightly longer total time, but NO errors and NO rate limits.
```

### What If A-2 Arrives Before C-1 in the Queue?

```
Queue order: A-2, C-1, B-2

Lambda-1 picks up A-2:
  Check: any highlight in RECORDING A with order < 2 not done?
  A-1 is 'clip_created' -> DONE ✅
  Process A-2 normally

Lambda-2 picks up C-1:
  Check: any highlight in RECORDING C with order < 1 not done?
  No predecessors -> process normally

These are DIFFERENT recordings. The queue order doesn't matter.
What matters is the processing_order WITHIN each recording.
```

### Summary Table

| Concern | How It's Handled |
|---------|-----------------|
| Mixed messages from different recordings in SQS | Advisory lock is per-recording; different recordings don't block each other |
| Sequence within one recording | `processing_order` check ensures A-2 waits for A-1, regardless of B or C |
| Rate limit with many recordings | `maximumConcurrency: 2` limits total Mux API calls to 2 at any moment |
| Queue order doesn't match recording order | Doesn't matter — sequential check is per-recording, not queue-position based |
| More recordings than Lambda slots | Recordings queue up naturally; SQS delivers when a Lambda slot frees up |
| One recording's failure affecting others | Each recording is independent; Recording A failing doesn't affect B or C |

### The Key Insight

**The SQS queue is a shared pipe, but the processing logic is per-recording.**

Think of it like a restaurant kitchen with 2 chefs (maxConcurrency=2):
- Orders (messages) from different tables (recordings) arrive on one ticket rail (SQS)
- Each chef can work on any table's order
- But within one table's order, dishes must be prepared in sequence (appetizer before main)
- Table A's order doesn't affect Table B's order
- If both chefs are busy, new orders wait on the rail until a chef is free

---

## 6. Highlight Status Lifecycle

### State Machine

```
              +─────────+
              | pending  |  (created during recording, source video not ready)
              +────┬─────+
                   |
                   | Webhook: source recording asset.ready
                   | OR recording already ready at creation time
                   |
              +────v─────+
              | queued    |  (SQS message sent, waiting for clipProcessor)
              +────┬─────+
                   |
                   | clipProcessor picks up message
                   |
              +────v──────+
              | processing |  (clipProcessor calling Mux API right now)
              +────┬──────+
                   |
          +────────+────────+──────────+
          |                 |          |
     201 Success       429 Rate    Error (5xx,
          |             Limit      network, etc.)
          |                 |          |
   +──────v──────+  +───────v────+  +──v────+
   | clip_created |  | rate_limited|  | failed|
   +──────┬──────+  +───────┬────+  +──┬────+
          |                 |          |
   Mux webhook:        Re-enqueue   Retries
   clip asset.ready     with delay   remaining?
          |                 |          |
   +──────v──────+  +───────v────+  +──+────+──────────────+
   |    ready     |  |   queued   |  |  YES: queued         |
   | (TERMINAL)   |  | (try again)|  |  NO: permanently_    |
   +──────────────+  +────────────+  |       failed         |
                                     +──────────────────────+
```

### Status Definitions

| Status | What It Means | What Happens Next |
|--------|---------------|-------------------|
| `pending` | User pressed highlight button; source recording not yet on Mux | Webhook handler will set it to `queued` when source asset is ready |
| `queued` | SQS message exists; waiting for clipProcessor Lambda to pick it up | clipProcessor will process it |
| `processing` | clipProcessor Lambda is actively calling Mux API for this highlight | Will transition to `clip_created`, `failed`, or `rate_limited` |
| `clip_created` | Mux accepted the clip creation request; clip is encoding on Mux's side | Mux will send `video.asset.ready` webhook when encoding finishes |
| `ready` | Clip is fully encoded; playback URL is available | **TERMINAL** - user can watch the clip |
| `failed` | Mux API call failed (server error, network error, etc.) | Will be retried if `retryCount < 5`; otherwise `permanently_failed` |
| `rate_limited` | Mux returned HTTP 429 (too many requests) | Re-enqueued with delay; separate counter (`rate_limit_retry_count`) |
| `permanently_failed` | All retries exhausted or unrecoverable error (400, 401) | **TERMINAL** - requires manual intervention or admin retry endpoint |

---

## 7. Error Handling

### Error Classification

The `classifyError()` function in `clip-processor.util.ts` categorizes every Mux API error:

```
+------------------+------+----------+---------+----------------------------------+
| Error Type       | HTTP | Retry?   | Max     | Why?                             |
+------------------+------+----------+---------+----------------------------------+
| Rate Limit       | 429  | YES      | 10      | Temporary. Mux is busy.          |
|                  |      |          |         | Just wait and try again.         |
+------------------+------+----------+---------+----------------------------------+
| Server Error     | 500  | YES      | 5       | Mux's servers had an issue.      |
|                  | 502  |          |         | Usually temporary.               |
|                  | 503  |          |         |                                  |
+------------------+------+----------+---------+----------------------------------+
| Network Error    | N/A  | YES      | 5       | Connection dropped (ECONNRESET,  |
|                  |      |          |         | ETIMEDOUT). Network issue.       |
+------------------+------+----------+---------+----------------------------------+
| Bad Input        | 400  | NO       | 0       | Our request is wrong (bad time   |
|                  |      |          |         | range, invalid asset ID, etc.).  |
|                  |      |          |         | Retrying won't fix it.           |
+------------------+------+----------+---------+----------------------------------+
| Auth Error       | 401  | NO       | 0       | Mux credentials are wrong.       |
|                  | 403  |          |         | Nothing will work until fixed.   |
+------------------+------+----------+---------+----------------------------------+
```

### Rate Limit Handling (HTTP 429) — Detailed

**Why it's special:** A 429 is NOT a failure. Mux is just saying "slow down." The request itself is perfectly valid. So we:
- Do NOT count it as an error retry
- Use a SEPARATE counter: `rate_limit_retry_count`
- Parse the `Retry-After` header from Mux's response
- Calculate delay using exponential backoff

```
Rate Limit Flow:

  clipProcessor calls Mux API
       |
  Mux returns 429 with Retry-After: 15
       |
  classifyError() -> type: 'rate_limit', retryAfter: 15
       |
  Calculate delay:
    exponentialDelay = baseDelay * 2^rateLimitRetryCount
                     = 10 * 2^0 = 10  (first rate limit hit)
    calculatedDelay  = max(retryAfter, exponentialDelay)
                     = max(15, 10) = 15
    finalDelay       = min(calculatedDelay, 120)  // cap at 120s
                     = 15
       |
  Update DB:
    status = 'rate_limited'
    rate_limit_retry_count = 1
    retryCount = UNCHANGED (not an error!)
    metadata.retryHistory += { errorType: 'rate_limit', httpStatus: 429, delayApplied: 15 }
       |
  Re-enqueue to SQS with DelaySeconds = 15
       |
  After 15 seconds, SQS delivers message again
  clipProcessor tries again
```

**Rate limit retry progression:**

```
Hit #1:  delay = max(retryAfter, 10 * 2^0) = max(15, 10)  = 15s
Hit #2:  delay = max(retryAfter, 10 * 2^1) = max(15, 20)  = 20s
Hit #3:  delay = max(retryAfter, 10 * 2^2) = max(15, 40)  = 40s
Hit #4:  delay = max(retryAfter, 10 * 2^3) = max(15, 80)  = 80s
Hit #5:  delay = max(retryAfter, 10 * 2^4) = max(15, 160) = 120s (capped)
...
Hit #10: delay = 120s (capped)
Hit #11: -> permanently_failed (max 10 rate limit retries)
```

### Server Error / Network Error Handling (5xx, ECONNRESET)

**Different from rate limits:** These are actual failures. We use `retryCount` and exponential backoff with fixed delays.

```
Error Retry Flow:

  clipProcessor calls Mux API
       |
  Mux returns 502 Bad Gateway  (or network timeout)
       |
  classifyError() -> type: 'server_error', httpStatus: 502
       |
  Current retryCount = 0, increment to 1
       |
  Is retryCount (1) >= MAX_ERROR_RETRIES (5)?
    NO -> retry
       |
  Lookup delay: ERROR_BACKOFF_DELAYS[retryCount - 1]
    ERROR_BACKOFF_DELAYS = [0, 30, 120, 300]
    delay = ERROR_BACKOFF_DELAYS[0] = 0s (immediate retry)
       |
  Update DB:
    status = 'failed'
    retryCount = 1
    failed_message = "Bad Gateway"
    metadata.retryHistory += { errorType: 'server_error', httpStatus: 502, delayApplied: 0 }
       |
  Re-enqueue to SQS with DelaySeconds = 0
```

**Error retry progression:**

```
Attempt 1: Original attempt (no delay)
Attempt 2: retryCount=1, delay = ERROR_BACKOFF_DELAYS[0] = 0s   (immediate)
Attempt 3: retryCount=2, delay = ERROR_BACKOFF_DELAYS[1] = 30s
Attempt 4: retryCount=3, delay = ERROR_BACKOFF_DELAYS[2] = 120s (2 minutes)
Attempt 5: retryCount=4, delay = ERROR_BACKOFF_DELAYS[3] = 300s (5 minutes)
Attempt 6: retryCount=5 -> retryCount >= MAX_ERROR_RETRIES (5)
           -> PERMANENTLY FAILED (no more retries)
```

### Bad Input (HTTP 400) — No Retry

```
  clipProcessor calls Mux API
       |
  Mux returns 400 Bad Request
  "The start_time must be less than the end_time"
       |
  classifyError() -> type: 'bad_input', httpStatus: 400
       |
  IMMEDIATELY mark as permanently_failed
  Reason: "Bad input (400): The start_time must be less than the end_time"
       |
  No re-enqueue. No retry. The input is invalid.
  An admin must investigate and potentially manually retry.
```

### Auth Error (HTTP 401/403) — No Retry

```
  clipProcessor calls Mux API
       |
  Mux returns 401 Unauthorized
       |
  classifyError() -> type: 'auth_error', httpStatus: 401
       |
  IMMEDIATELY mark as permanently_failed
  Reason: "Auth error (401): ..."
  Log: "AUTH ERROR — check Mux credentials"
       |
  No re-enqueue. Mux credentials need to be fixed in environment variables.
```

### Two Separate Counters

This is the key design decision — rate limits and errors are tracked independently:

```
                        +------------------+     +---------------------------+
                        | retryCount       |     | rate_limit_retry_count    |
                        | (error counter)  |     | (429 counter)             |
                        +------------------+     +---------------------------+
Incremented when:       5xx, network error       429 only
NOT incremented when:   429                      5xx, network error
Max before perm fail:   5                        10
Backoff strategy:       Fixed delays             Exponential with Retry-After
                        [0, 30, 120, 300]s       max(retryAfter, 10*2^n), cap 120s
Reset on success:       YES (to 0)               YES (to 0)
```

### Metadata / Retry History

Every error is recorded in the `metadata` JSONB field for debugging:

```json
{
  "errorRetryCount": 2,
  "rateLimitRetryCount": 1,
  "retryHistory": [
    {
      "attempt": 1,
      "timestamp": "2025-07-15T10:30:00.000Z",
      "errorType": "server_error",
      "httpStatus": 502,
      "errorMessage": "Bad Gateway",
      "delayApplied": 0
    },
    {
      "attempt": 2,
      "timestamp": "2025-07-15T10:30:05.000Z",
      "errorType": "rate_limit",
      "httpStatus": 429,
      "errorMessage": "Rate limited",
      "delayApplied": 15
    },
    {
      "attempt": 3,
      "timestamp": "2025-07-15T10:30:25.000Z",
      "errorType": "server_error",
      "httpStatus": 500,
      "errorMessage": "Internal Server Error",
      "delayApplied": 30
    }
  ],
  "permanentlyFailed": false
}
```

When permanently failed:

```json
{
  "permanentlyFailed": true,
  "permanentlyFailedAt": "2025-07-15T10:35:00.000Z",
  "permanentlyFailedReason": "Max error retries exhausted (5/5): Internal Server Error"
}
```

---

## 8. Retry Strategy

### Failures Do NOT Block the Chain

**Key design principle:** If a highlight fails, the chain **skips it** and continues to the next one. Failed highlights are retried later by the sweep Lambda.

```
Example: Recording with 5 highlights

  H-1 (order=1) ✅ success → clip_created → enqueue H-2
  H-2 (order=2) ❌ Mux 500 error → status='failed' → enqueue H-3 (skip H-2!)
  H-3 (order=3) ✅ success → clip_created → enqueue H-4
  H-4 (order=4) ❌ Mux 429 rate limit → status='rate_limited' → enqueue H-5 (skip H-4!)
  H-5 (order=5) ✅ success → clip_created → done

  Result: H-1, H-3, H-5 are ready. H-2, H-4 will be retried by sweep Lambda.
  The chain was NEVER blocked. User gets 3 out of 5 clips immediately.
```

**How it works (two mechanisms):**

1. **`enqueueNextHighlight()` runs on BOTH success and failure** — the next highlight is always enqueued regardless of the current one's outcome.

2. **`hasPendingPredecessors()` treats failed/rate_limited as non-blocking** — if H-2 is `failed` and H-3 arrives, H-3 sees H-2 as non-blocking and processes immediately.

**Non-blocking statuses** (these do NOT block the next highlight):
- `clip_created` — done
- `ready` — done
- `permanently_failed` — gave up
- `failed` — will be retried later, but don't wait for it
- `rate_limited` — will be retried later, but don't wait for it

**Blocking statuses** (these DO block the next highlight):
- `pending` — not yet queued
- `queued` — about to be processed
- `processing` — actively being processed right now

### Complete Retry Decision Tree

```
Error occurs in clipProcessor
       |
       v
  Classify error (classifyError())
       |
       +-- 429? ──────────────> RATE LIMIT path
       |                          rate_limit_retry_count++
       |                          count > 10? -> permanently_failed
       |                          else -> re-enqueue failed one with delay
       |                          ALSO enqueue NEXT highlight (don't block chain)
       |
       +-- 400? ──────────────> BAD INPUT path
       |                          permanently_failed IMMEDIATELY
       |                          ALSO enqueue NEXT highlight
       |
       +-- 401/403? ─────────> AUTH ERROR path
       |                          permanently_failed IMMEDIATELY
       |                          + alert in logs
       |                          ALSO enqueue NEXT highlight
       |
       +-- 500/502/503? ─────> SERVER ERROR path
       |                          retryCount++
       |                          count >= 5? -> permanently_failed
       |                          else -> re-enqueue failed one with backoff
       |                          ALSO enqueue NEXT highlight (don't block chain)
       |
       +-- network error? ───> NETWORK ERROR path
                                  (same as server error)
```

### When Highlights Are NOT Deleted

**Highlights are NEVER automatically deleted.** The user explicitly pressed the button to create them. Instead:

- They are marked `permanently_failed` with a reason
- The `metadata` field contains full error history
- An admin or the user can manually trigger a retry by resetting the highlight to `queued`

### Sweep Lambda Catches Orphans

The `retryFailedHighlights` Lambda runs every 10 minutes and catches highlights that fell through the cracks:

| What It Catches | How It Fixes It |
|-----------------|-----------------|
| `processing` for > 5 min (Lambda crashed) | Reset to `queued`, re-enqueue |
| `pending` with recording already ready (webhook missed) | Set to `queued`, enqueue |
| `rate_limited` for > 10 min (SQS message lost) | Reset to `queued`, re-enqueue |
| `failed` with retryCount < 5 | Re-enqueue with backoff delay |
| `failed` with retryCount >= 5 | Mark `permanently_failed` |
| `queued` for > 15 min (SQS message lost) | Re-enqueue |

---

## 9. Webhook Optimization: Check Highlight First

### Why Check Highlight Before Recording?

Mux sends the same `video.asset.ready` webhook for both source recordings and clip assets. For a recording with N highlights, there will be N+1 webhooks total (1 recording + N clips). Clip webhooks are far more frequent.

```
OPTIMIZED (current code): Check highlight FIRST

  Webhook arrives with assetId
       |
  Step 1: SELECT FROM recording_highlights WHERE asset_id = $1
       |
  Found? → This is a CLIP becoming ready
           Update to 'ready' → DONE (1 query)
       |
  Not found? ↓
       |
  Step 2: SELECT FROM recordings WHERE mux_asset_id = $1
       |
  Found? → This is a SOURCE RECORDING
           Find pending highlights → set to 'queued' → enqueue first to SQS
       |
  Not found? → Unknown asset, ignore

For 10 highlights: 1 + 1 + (10 × 1) = 12 queries total
vs checking recording first: 1 + (10 × 2) = 21 queries total (43% fewer)
```

---

## 10. Webhook Idempotency

### Problem

Mux can deliver the same webhook multiple times. Without deduplication:
- The same highlight could be enqueued to SQS twice
- The same clip could be created twice in Mux

### Solution: `webhook_events` Table

```sql
webhook_events:
  id              UUID (PK)
  mux_event_id    VARCHAR(255) UNIQUE    -- "video.asset.ready:<assetId>:ready"
  event_type      VARCHAR(100)
  asset_id        VARCHAR(255)
  processed_at    TIMESTAMP
  response_status VARCHAR(50)            -- 'processing', 'processed'
  created_at      TIMESTAMP
```

### How It Works

```
Webhook arrives: { type: "video.asset.ready", data: { id: "abc123", status: "ready" } }
       |
  Compute key: "video.asset.ready:abc123:ready"
       |
  INSERT INTO webhook_events (mux_event_id, event_type, asset_id)
  VALUES ('video.asset.ready:abc123:ready', 'video.asset.ready', 'abc123')
  ON CONFLICT (mux_event_id) DO NOTHING
  RETURNING id
       |
  Row returned?
  +-- YES: First time -> process the webhook normally
  +-- NO (conflict): Duplicate -> return 200 immediately, skip processing
```

### Additional Idempotency in clipProcessor

Even with webhook deduplication, SQS standard queues deliver at-least-once. The clipProcessor has its own protections:

1. **Status check:** If highlight is already `clip_created`, `ready`, or `permanently_failed` -> skip
2. **Advisory lock:** Only one Lambda can process a recording at a time
3. **Optimistic lock:** `WHERE lock_version = $expected` prevents stale updates

### Cleanup

The sweep Lambda deletes webhook_events older than 7 days to prevent table bloat.

---

## 11. Sweep Lambda (retryFailedHighlights)

### What It Does

The sweep Lambda is a **safety net**. It runs every 10 minutes and catches anything that got stuck. It **never calls Mux directly** — it only re-enqueues to SQS.

### Seven Sweep Steps

```
Step 1: STUCK PROCESSING (Lambda crashed mid-work)
        WHERE status = 'processing' AND updated_at < 5 minutes ago
        Action: Reset to 'queued', re-enqueue to SQS

Step 2: MISSED PENDING (webhook didn't fire or was lost)
        WHERE status = 'pending' AND recording.mux_asset_id IS NOT NULL AND recording.status = 'ready'
        Action: Set to 'queued', enqueue to SQS

Step 3: STUCK RATE_LIMITED (SQS delay message was lost)
        WHERE status = 'rate_limited' AND updated_at < 10 minutes ago
        Action: Reset to 'queued', re-enqueue to SQS

Step 4: FAILED WITH RETRIES (can try again)
        WHERE status = 'failed' AND retryCount < 5 AND recording.mux_asset_id IS NOT NULL
        Action: Set to 'queued', re-enqueue with backoff delay

Step 5: FAILED EXHAUSTED (no more retries)
        WHERE status = 'failed' AND retryCount >= 5
        Action: Mark as 'permanently_failed' with metadata

Step 6: WEBHOOK CLEANUP
        DELETE FROM webhook_events WHERE created_at < 7 days ago

Step 7: STUCK QUEUED (SQS message was lost)
        WHERE status = 'queued' AND updated_at < 15 minutes ago AND recording.mux_asset_id IS NOT NULL
        Action: Re-enqueue to SQS
```

---

## 12. Database Schema

### recording_highlights Table

```sql
CREATE TABLE recording_highlights (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_id            UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,

  -- Timing
  button_click_timestamp  TIMESTAMP NOT NULL,       -- when user pressed button
  relative_timestamp      VARCHAR,                  -- "3:02" or "1:05:30"

  -- Sequence
  processing_order        INTEGER,                  -- 1, 2, 3, ... per recording

  -- Mux data
  source_asset_id         VARCHAR,                  -- source recording's Mux asset ID
  asset_id                VARCHAR,                  -- this clip's Mux asset ID
  playback_id             TEXT,                     -- Mux playback ID
  mux_public_playback_url TEXT,                     -- "https://stream.mux.com/{id}.m3u8"

  -- Status tracking
  status                  VARCHAR,                  -- see status lifecycle above
  failed_message          VARCHAR(10000),           -- error description
  isClipCreated           BOOLEAN DEFAULT false,    -- legacy flag

  -- Retry counters
  retryCount              INTEGER DEFAULT 0,        -- error retries (5xx, network)
  rate_limit_retry_count  INTEGER DEFAULT 0,        -- 429 retries (separate!)

  -- Concurrency control
  lock_version            INTEGER DEFAULT 0,        -- optimistic locking
  sqs_message_id          VARCHAR(255),             -- SQS message tracking

  -- Audit
  metadata                JSONB,                    -- retryHistory, error details

  -- S3
  bucketName              VARCHAR,
  s3path                  TEXT,

  -- Timestamps
  created_at              TIMESTAMP DEFAULT now(),
  updated_at              TIMESTAMP DEFAULT now()
);

-- Indexes
CREATE INDEX IDX_rh_recording_status_order
  ON recording_highlights(recording_id, status, processing_order);

CREATE INDEX IDX_rh_status_retry
  ON recording_highlights(status, "retryCount")
  WHERE status IN ('failed', 'rate_limited', 'processing');
```

### webhook_events Table

```sql
CREATE TABLE webhook_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mux_event_id    VARCHAR(255) UNIQUE NOT NULL,  -- deduplication key
  event_type      VARCHAR(100),
  asset_id        VARCHAR(255),
  processed_at    TIMESTAMP DEFAULT now(),
  response_status VARCHAR(50),                   -- 'processing', 'processed'
  created_at      TIMESTAMP DEFAULT now()
);

CREATE INDEX IDX_webhook_events_asset_id ON webhook_events(asset_id);
CREATE INDEX IDX_webhook_events_created_at ON webhook_events(created_at);
```

---

## 13. Infrastructure (SQS + Lambda)

### SQS Queues (serverless.yml resources)

```yaml
resources:
  Resources:
    ClipProcessingQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: fieldflicks-${stage}-clip-processing
        VisibilityTimeout: 960        # 16 min (> Lambda timeout of 900s/15min)
        MessageRetentionPeriod: 1209600  # 14 days
        ReceiveMessageWaitTimeSeconds: 20  # long polling (cost efficient)
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt ClipProcessingDLQ.Arn
          maxReceiveCount: 5           # after 5 SQS-level failures -> DLQ

    ClipProcessingDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: fieldflicks-${stage}-clip-processing-dlq
        MessageRetentionPeriod: 1209600  # 14 days
```

### clipProcessor Lambda

```yaml
clipProcessor:
  handler: dist/src/lambda/clip-processor/clip-processor_lambda.main
  memorySize: 512
  timeout: 900                      # 15 minutes
  environment:
    CLIP_PROCESSING_QUEUE_URL: !Ref ClipProcessingQueue
  events:
    - sqs:
        arn: !GetAtt ClipProcessingQueue.Arn
        batchSize: 1                # process one message at a time
        maximumConcurrency: 2       # at most 2 Lambda instances running simultaneously
```

### Why These Settings Matter

| Setting | Value | Why |
|---------|-------|-----|
| `batchSize: 1` | One message per Lambda invocation | Each clip needs full attention; if it fails, only one message is affected |
| `maximumConcurrency: 2` | At most 2 Lambdas running at once | Mux allows ~5 req/s; with 2 concurrent + 5s delays, we stay well under |
| `VisibilityTimeout: 960` | 16 minutes | Must be > Lambda timeout (900s). If Lambda crashes, SQS waits 16 min before making message visible again |
| `maxReceiveCount: 5` | 5 SQS delivery attempts | After 5 times SQS tries to deliver and Lambda throws, message goes to DLQ |
| `ReceiveMessageWaitTimeSeconds: 20` | Long polling | SQS waits up to 20s for messages before returning empty. Reduces API calls and cost |

### Rate Limit Prevention Layers

```
Layer 1: maximumConcurrency = 2
         At most 2 Mux API calls in flight at any time

Layer 2: INTER_CLIP_DELAY_SECONDS = 5
         After successful clip, next one is enqueued with 5s SQS delay

Layer 3: 429 backoff
         If Mux says "slow down", exponential delay up to 120s

Layer 4: Sequential per-recording
         Only one clip processes per recording at a time
         (advisory lock ensures this)

Combined effect:
  - Worst case: 2 clips/5s = 0.4 req/s (far below Mux's ~5 req/s limit)
  - Rate limits are nearly impossible to hit in normal operation
  - If they do hit, the system automatically backs off and recovers
```

---

## 14. Edge Cases

### Multiple Recordings Complete at the Same Time

```
Recording A (5 highlights) and Recording B (3 highlights) both get
"video.asset.ready" webhooks within seconds.

What happens:
- Each webhook enqueues its own highlights to SQS
- Advisory lock is per-recording (hashtext(A) != hashtext(B))
- Recording A and B process concurrently
- maximumConcurrency=2 ensures at most 2 Mux API calls at once
- If both fire simultaneously, one gets a Lambda, the other waits for SQS delivery
```

### Lambda Crashes Mid-Processing

```
clipProcessor is calling Mux API for highlight 7.
Lambda suddenly crashes (out of memory, timeout, etc.)

What happens:
1. Highlight 7 is stuck in status='processing' in the database
2. SQS visibility timeout (960s) expires -> message becomes visible again
3. Before that, sweep Lambda (every 10 min) finds highlights stuck
   in 'processing' for > 5 minutes
4. Sweep Lambda resets highlight 7 to 'queued' and re-enqueues to SQS
5. clipProcessor picks it up again and retries
```

### Webhook Arrives Before DB Update

```
clipProcessor calls Mux API -> Mux creates clip instantly
Mux sends "video.asset.ready" webhook for the clip
Webhook handler updates highlight to 'ready'
THEN clipProcessor finishes and tries to update highlight to 'clip_created'

What happens:
- The optimistic lock (lock_version) catches this
- clipProcessor sees 0 rows affected (expected version doesn't match)
- It logs a warning and moves on
- Highlight is already 'ready' (the best state), so no harm done
```

### Highlight Created After Recording is Already Ready

```
User presses highlight button late (after recording upload + Mux processing)
The recording already has mux_asset_id set.

What happens:
1. createRecordingHighlight() checks: recording.mux_asset_id && recording.isVideoCreated
2. Both are true -> immediately sets status='queued' and enqueues to SQS
3. clipProcessor processes it normally
4. No need to wait for any webhook
```

### Source Recording Fails in Mux

```
The source recording's Mux asset fails (video.asset.errored webhook)

What happens:
1. handleAssetErrored() finds the recording by mux_asset_id
2. Updates recording status = 'failed'
3. ALL highlights for that recording are set to 'permanently_failed'
   with reason: "Source recording asset errored: <error message>"
4. No clips can ever be created (source video is broken)
```

### SQS Delivers Same Message Twice

```
SQS standard queues guarantee at-least-once delivery.
Same message delivered to two Lambda instances.

What happens:
1. Lambda A processes message for highlight 5
   - Acquires advisory lock for recording -> SUCCESS
   - Sets status to 'processing' with optimistic lock -> SUCCESS
   - Calls Mux API

2. Lambda B processes same message for highlight 5
   - Tries advisory lock -> FAILS (Lambda A holds it)
   - Re-queues message with 15s delay

3. After 15s, Lambda picks up re-queued message
   - Advisory lock available now
   - Status check: highlight 5 is 'clip_created' (already done)
   - SKIPS processing (idempotent)
```

### DB Connection Drops in Lambda

```
PostgreSQL connection drops while clipProcessor is running

What happens:
1. Advisory lock is automatically released when the DB connection closes
2. The SQS message becomes visible again after visibility timeout
3. Next Lambda invocation establishes a fresh connection
4. Retries the clip creation
```

---

## 15. File Reference

### Core Files

| File | Purpose |
|------|---------|
| `src/recording/service/recording-highlight.service.ts` | Main service: highlight creation, webhook handling, SQS enqueue |
| `src/recording/controller/mux-webhook.controller.ts` | Webhook endpoint, signature verification |
| `src/recording/entities/recording-highlights.entity.ts` | TypeORM entity with all columns |
| `src/recording/entities/webhook-event.entity.ts` | Webhook deduplication entity |
| `src/constant/constant.ts` | All processing constants, status enums, backoff delays |

### Lambda Functions

| File | Purpose |
|------|---------|
| `src/lambda/clip-processor/clip-processor_lambda.ts` | SQS-triggered Lambda handler |
| `src/lambda/clip-processor/services/clip-processor.service.ts` | Full clip processing logic: sequential check, advisory lock, Mux API call, error handling |
| `src/lambda/clip-processor/types/clip-processor.types.ts` | TypeScript interfaces for messages and results |
| `src/lambda/clip-processor/utils/clip-processor.util.ts` | Error classification, rate limit delay calculation, timestamp parsing |
| `src/lambda/retry-failed-highlights/retry-failed-highlights_lambda.ts` | Sweep Lambda: finds stuck/failed highlights, re-enqueues to SQS |
| `src/lambda/retry-failed-highlights/utils/lambda.util.ts` | Sweep Lambda utilities |

### Infrastructure

| File | Purpose |
|------|---------|
| `serverless.yml` | SQS queues, Lambda definitions, IAM permissions, event sources |
| `db/migrations/1760000000001-AddClipProcessingColumns.ts` | Adds processing_order, rate_limit_retry_count, sqs_message_id, lock_version |
| `db/migrations/1760000000002-CreateWebhookEventsTable.ts` | Creates webhook_events table for idempotency |

### Constants Reference (from `src/constant/constant.ts`)

```typescript
CLIP_PROCESSING = {
  MAX_CONCURRENCY: 2,                        // Lambda concurrent invocations
  INTER_CLIP_DELAY_SECONDS: 5,               // Delay between sequential clips
  MAX_ERROR_RETRIES: 5,                      // 5xx/network max retries
  MAX_RATE_LIMIT_RETRIES: 10,                // 429 max retries
  RATE_LIMIT_DELAY_CAP_SECONDS: 120,         // Max 429 backoff delay
  RATE_LIMIT_BASE_DELAY_SECONDS: 10,         // Base for exponential 429 delay
  ERROR_BACKOFF_DELAYS: [0, 30, 120, 300],   // Fixed delays for error retries
  NOT_MY_TURN_DELAY_SECONDS: 30,             // Re-queue when sequence not ready
  ADVISORY_LOCK_DELAY_SECONDS: 15,           // Re-queue when lock held
  STUCK_PROCESSING_THRESHOLD_MINUTES: 5,     // Sweep: processing too long
  STUCK_RATE_LIMITED_THRESHOLD_MINUTES: 10,   // Sweep: rate_limited too long
  WEBHOOK_EVENTS_CLEANUP_DAYS: 7,            // Sweep: delete old webhook events
}

HIGHLIGHT_STATUS = {
  PENDING, QUEUED, PROCESSING, CLIP_CREATED,
  READY, FAILED, RATE_LIMITED, PERMANENTLY_FAILED
}

TERMINAL_STATUSES = [CLIP_CREATED, READY, PERMANENTLY_FAILED]
```
